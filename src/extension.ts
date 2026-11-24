import * as vscode from 'vscode';
import {
  authorize,
  clearSession,
  loadSession,
  saveSession
} from './auth';
import {
  createUnauthorizedData,
  dailyCheckin,
  fetchDashboard
} from './api';
import { recordSnapshot } from './usage';
import { renderDashboardHtml } from './dashboard';
import { AuthSession, DashboardData } from './types';

const VIEW_ID = 'workbuddyCredit.dashboard';

let webviewView: vscode.WebviewView | undefined;
let panel: vscode.WebviewPanel | undefined;
let currentData: DashboardData | undefined;
let statusBar: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let autoRefreshDisposable: vscode.Disposable | undefined;

function getRegion(): string {
  return vscode.workspace.getConfiguration('workbuddyCredit').get<string>('region', 'cn') || 'cn';
}

function formatCompact(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}w`;
  }
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function localResourceRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  return [
    vscode.Uri.file(context.extensionPath),
    vscode.Uri.joinPath(vscode.Uri.file(context.extensionPath), 'node_modules', 'echarts', 'dist')
  ];
}

class DashboardViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    webviewView = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots(this.context)
    };

    view.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === 'refresh') {
        await loadAndUpdate(this.context, getRegion());
      } else if (message?.command === 'authorize') {
        await doAuthorize(this.context, getRegion());
      } else if (message?.command === 'logout') {
        await doLogout(this.context, getRegion());
      } else if (message?.command === 'checkin') {
        try {
          const session = await loadSession(this.context);
          if (!session) {
            await view.webview.postMessage({
              type: 'checkinResult',
              success: false,
              message: '尚未授权，请先登录'
            });
            return;
          }
          const result = await dailyCheckin(session);
          await view.webview.postMessage({ type: 'checkinResult', ...result });
          if (result.success) {
            await loadAndUpdate(this.context, getRegion());
          }
        } catch (error) {
          await view.webview.postMessage({
            type: 'checkinResult',
            success: false,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });

    view.onDidDispose(() => {
      webviewView = undefined;
    });

    if (currentData) {
      view.webview.html = renderDashboardHtml(view.webview, this.context.extensionUri, currentData);
    } else {
      void loadAndUpdate(this.context, getRegion());
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'workbuddy-credit.openDashboard';
  statusBar.text = '$(graph) WorkBuddy';
  statusBar.tooltip = '打开 WorkBuddy 积分看板';
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VIEW_ID,
      new DashboardViewProvider(context),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('workbuddy-credit.openDashboard', async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      if (!currentData) {
        await loadAndUpdate(context, getRegion());
      }
    }),
    vscode.commands.registerCommand('workbuddy-credit.refresh', async () => {
      await loadAndUpdate(context, getRegion());
    }),
    vscode.commands.registerCommand('workbuddy-credit.logout', async () => {
      await doLogout(context, getRegion());
    })
  );

  setupAutoRefresh(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('workbuddyCredit.refreshInterval') ||
        event.affectsConfiguration('workbuddyCredit.region')
      ) {
        if (event.affectsConfiguration('workbuddyCredit.region')) {
          currentData = undefined;
        }
        setupAutoRefresh(context);
      }
    })
  );
}

function setupAutoRefresh(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (autoRefreshDisposable) {
    autoRefreshDisposable.dispose();
    autoRefreshDisposable = undefined;
  }

  const minutes = vscode.workspace.getConfiguration('workbuddyCredit').get<number>('refreshInterval', 5);
  if (!minutes || minutes <= 0) {
    return;
  }

  refreshTimer = setInterval(() => {
    if (currentData?.authorized && (webviewView?.visible || panel?.visible)) {
      void loadAndUpdate(context, getRegion());
    }
  }, minutes * 60 * 1000);

  autoRefreshDisposable = new vscode.Disposable(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  });
  context.subscriptions.push(autoRefreshDisposable);
}

function renderToTarget(context: vscode.ExtensionContext, data: DashboardData): void {
  if (webviewView) {
    webviewView.webview.html = renderDashboardHtml(webviewView.webview, context.extensionUri, data);
  }
  if (panel) {
    panel.webview.html = renderDashboardHtml(panel.webview, context.extensionUri, data);
  }
}

async function doAuthorize(context: vscode.ExtensionContext, region: string): Promise<void> {
  console.error('[workbuddy-credit] doAuthorize triggered');
  const postAuth = (payload: Record<string, unknown>): void => {
    void webviewView?.webview.postMessage({ type: 'authStatus', ...payload });
  };
  postAuth({ state: 'waiting', message: '已打开浏览器，请完成微信扫码登录并在手机上确认…' });
  try {
    const session = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'WorkBuddy 授权中，请在浏览器完成登录…',
        cancellable: false
      },
      () => authorize(region, {
        onUrl: (authUrl) => postAuth({ state: 'waiting', message: '请在刚打开的浏览器窗口扫码登录', authUrl }),
        onProgress: (attempt, totalSeconds, code, msg) => postAuth({
          state: 'waiting',
          message: `等待浏览器授权中… ${attempt * 2}/${totalSeconds} 秒（code=${code} ${String(msg).slice(0, 20)}）`,
          progress: attempt
        })
      })
    );
    console.error('[workbuddy-credit] authorize returned session, saving');
    await saveSession(context, session);
    console.error('[workbuddy-credit] session saved, loading dashboard');
    await loadAndUpdate(context, region, session);
    postAuth({ state: 'idle' });
    void vscode.window.showInformationMessage('WorkBuddy 授权成功');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[workbuddy-credit] doAuthorize error: ' + reason, error);
    postAuth({ state: 'error', message: reason });
    void vscode.window.showErrorMessage(`授权失败：${reason}`);
  }
}

async function doLogout(context: vscode.ExtensionContext, region: string): Promise<void> {
  await clearSession(context);
  const data = createUnauthorizedData(region);
  currentData = data;
  renderToTarget(context, data);
  updateStatusBar(data);
  void vscode.window.showInformationMessage('已退出 WorkBuddy 账号');
}

async function loadAndUpdate(
  context: vscode.ExtensionContext,
  region: string,
  explicitSession?: AuthSession
): Promise<void> {
  const session = explicitSession ?? await loadSession(context);
  if (!session) {
    const data = createUnauthorizedData(region);
    currentData = data;
    renderToTarget(context, data);
    updateStatusBar(data);
    return;
  }

  try {
    const data = await fetchDashboard(session, region);
    recordSnapshot(context, data.summary.usedCredits, data.summary.remainCredits);
    data.nickname = session.nickname;

    currentData = data;
    renderToTarget(context, data);
    updateStatusBar(data);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const data = createUnauthorizedData(region);
    data.authorized = true;
    data.error = reason;
    data.notice = `读取实时数据失败：${reason}`;
    currentData = data;
    renderToTarget(context, data);
    updateStatusBar(data);
    void vscode.window.showErrorMessage(`WorkBuddy 积分看板加载失败：${reason}`);
  }
}

function updateStatusBar(data: DashboardData): void {
  if (!data.authorized) {
    statusBar.text = '$(graph) WorkBuddy 未授权';
    statusBar.tooltip = '点击打开看板并登录 WorkBuddy 账号';
    return;
  }
  statusBar.text = `$(graph) WorkBuddy ${formatCompact(data.summary.remainCredits)}`;
  statusBar.tooltip = [
    'WorkBuddy 积分看板',
    `剩余：${data.summary.remainCredits}`,
    `已用：${data.summary.usedCredits}`,
    '点击查看完整看板'
  ].join('\n');
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}
