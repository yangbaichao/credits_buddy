import * as vscode from 'vscode';
import {
  authorize,
  clearAllAccounts,
  loadAccounts,
  loadActiveAccount,
  removeAccount,
  saveAccount,
  setActiveAccount
} from './auth';
import {
  createUnauthorizedData,
  dailyCheckin,
  fetchDashboard
} from './api';
import { recordSnapshot } from './usage';
import { renderDashboardHtml } from './dashboard';
import { AccountListItem, AccountSession, DashboardData } from './types';

const VIEW_ID = 'workbuddyCredit.dashboard';

let webviewView: vscode.WebviewView | undefined;
let panel: vscode.WebviewPanel | undefined;
let currentData: DashboardData | undefined;
let statusBar: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let autoRefreshDisposable: vscode.Disposable | undefined;

function formatCompact(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}w`;
  }
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function getRegion(): string {
  return vscode.workspace.getConfiguration('workbuddyCredit').get<string>('region', 'cn') || 'cn';
}

function maskUid(uid?: string): string {
  if (!uid) return '';
  return uid.length <= 8 ? uid : `${uid.slice(0, 4)}…${uid.slice(-4)}`;
}

function toAccountListItems(accounts: AccountSession[], activeId?: string): AccountListItem[] {
  return accounts
    .slice()
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map((account) => ({
      id: account.id,
      label: account.nickname || (account.region === 'global' ? 'CodeBuddy 用户' : 'WorkBuddy 用户'),
      region: account.region,
      uidMask: maskUid(account.uid),
      isActive: account.id === activeId
    }));
}

function attachAccounts(data: DashboardData, accounts: AccountSession[], activeId?: string): DashboardData {
  data.accounts = toAccountListItems(accounts, activeId);
  data.activeAccountId = activeId;
  return data;
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
        await loadAndUpdate(this.context);
      } else if (message?.command === 'authorize') {
        await doAuthorize(this.context, 'login', undefined, message.region);
      } else if (message?.command === 'addAccount') {
        await doAuthorize(this.context, 'add');
      } else if (message?.command === 'reauthorize') {
        await doAuthorize(this.context, 'reauth', message.id);
      } else if (message?.command === 'switchAccount') {
        await doSwitchAccount(this.context, message.id);
      } else if (message?.command === 'removeAccount') {
        await doRemoveAccount(this.context, message.id);
      } else if (message?.command === 'removeAllAccounts') {
        await doRemoveAllAccounts(this.context);
      } else if (message?.command === 'logout') {
        const id = message.id ?? (await loadActiveAccount(this.context))?.id;
        await doRemoveAccount(this.context, id);
      } else if (message?.command === 'checkin') {
        try {
          const session = await loadActiveAccount(this.context);
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
            await loadAndUpdate(this.context, session);
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
      view.webview.html = renderDashboardHtml(
        view.webview,
        this.context.extensionUri,
        createUnauthorizedData(getRegion()),
        true
      );
      void loadAndUpdate(this.context);
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
        await loadAndUpdate(context);
      }
    }),
    vscode.commands.registerCommand('workbuddy-credit.refresh', async () => {
      await loadAndUpdate(context);
    }),
    vscode.commands.registerCommand('workbuddy-credit.logout', async () => {
      const active = await loadActiveAccount(context);
      await doRemoveAccount(context, active?.id);
    })
  );

  setupAutoRefresh(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('workbuddyCredit.refreshInterval')) {
        setupAutoRefresh(context);
      }
      if (event.affectsConfiguration('workbuddyCredit.region') && !currentData?.authorized) {
        void loadAndUpdate(context);
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
      void loadAndUpdate(context);
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

function postLoading(message = '加载中…'): void {
  void webviewView?.webview.postMessage({ type: 'loading', message });
  void panel?.webview.postMessage({ type: 'loading', message });
}

function postHideLoading(): void {
  void webviewView?.webview.postMessage({ type: 'loading', hide: true });
  void panel?.webview.postMessage({ type: 'loading', hide: true });
}

type AuthMode = 'login' | 'add' | 'reauth';

async function doAuthorize(
  context: vscode.ExtensionContext,
  mode: AuthMode,
  accountId?: string,
  region?: string
): Promise<void> {
  console.error('[workbuddy-credit] doAuthorize triggered, mode=' + mode);
  const postAuth = (payload: Record<string, unknown>): void => {
    const body = mode === 'login' ? payload : { mode, ...payload };
    void webviewView?.webview.postMessage({ type: 'authStatus', ...body });
  };
  const previousId = mode === 'reauth'
    ? (accountId ?? (await loadActiveAccount(context))?.id)
    : undefined;
  const previous = previousId ? (await loadAccounts(context))[previousId] : undefined;
  const rawRegion = region || previous?.region || getRegion();
  const targetRegion = rawRegion === 'global' ? 'global' : 'cn';
  postAuth({ state: 'waiting', message: '已打开浏览器，请完成官方登录并在手机上确认…' });
  try {
    const session = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: mode === 'reauth' ? '重新授权中，请在浏览器完成登录…' : '积分账号授权中，请在浏览器完成登录…',
        cancellable: false
      },
      () => authorize(targetRegion, {
        onUrl: (authUrl) => postAuth({ state: 'waiting', message: '请在刚打开的浏览器窗口扫码登录', authUrl }),
        onProgress: (attempt, totalSeconds, code, msg) => postAuth({
          state: 'waiting',
          message: `等待浏览器授权中… ${attempt * 2}/${totalSeconds} 秒（code=${code} ${String(msg).slice(0, 20)}）`,
          progress: attempt
        })
      })
    );
    console.error('[workbuddy-credit] authorize returned session, saving');
    const account = await saveAccount(context, session, previousId);
    console.error('[workbuddy-credit] account saved: ' + account.id);
    await loadAndUpdate(context, account);
    postAuth({ state: 'idle' });
    const label = account.nickname || 'WorkBuddy 用户';
    if (mode === 'add') {
      void vscode.window.showInformationMessage(`已添加并切换到 ${label}`);
    } else if (mode === 'reauth') {
      void vscode.window.showInformationMessage(`已重新授权 ${label}`);
    } else {
      void vscode.window.showInformationMessage('授权成功');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[workbuddy-credit] doAuthorize error: ' + reason, error);
    postAuth({ state: 'error', message: reason });
    void vscode.window.showErrorMessage(`授权失败：${reason}`);
  }
}

async function doSwitchAccount(context: vscode.ExtensionContext, id?: string): Promise<void> {
  if (!id) return;
  try {
    const account = await setActiveAccount(context, id);
    if (!account) {
      postHideLoading();
      return;
    }
    await loadAndUpdate(context, account);
  } catch (error) {
    postHideLoading();
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`切换账号失败：${reason}`);
  }
}

async function doRemoveAccount(context: vscode.ExtensionContext, id?: string): Promise<void> {
  if (!id) return;
  const accounts = await loadAccounts(context);
  const target = accounts[id];
  if (!target) return;
  const label = target.nickname || 'WorkBuddy 用户';
  const choice = await vscode.window.showWarningMessage(
    `确定退出并删除账号「${label}」吗？该账号的本地登录信息将被清除。`,
    { modal: true },
    '确认退出'
  );
  if (choice !== '确认退出') return;
  await removeAccount(context, id);
  await loadAndUpdate(context);
  void vscode.window.showInformationMessage(`已退出 ${label}`);
}

async function doRemoveAllAccounts(context: vscode.ExtensionContext): Promise<void> {
  const accounts = await loadAccounts(context);
  if (!Object.keys(accounts).length) return;
  const choice = await vscode.window.showWarningMessage(
    '确定退出全部账号吗？所有本地登录信息将被清除。',
    { modal: true },
    '确认退出'
  );
  if (choice !== '确认退出') return;
  await clearAllAccounts(context);
  await loadAndUpdate(context);
  void vscode.window.showInformationMessage('已退出全部账号');
}

async function loadAndUpdate(
  context: vscode.ExtensionContext,
  explicitAccount?: AccountSession
): Promise<void> {
  postLoading('正在加载积分数据…');
  const session = explicitAccount ?? await loadActiveAccount(context);
  const accountList = Object.values(await loadAccounts(context));
  const activeId = session?.id;
  if (!session) {
    const data = attachAccounts(createUnauthorizedData(getRegion()), accountList, undefined);
    currentData = data;
    renderToTarget(context, data);
    updateStatusBar(data);
    return;
  }

  const region = session.region;
  try {
    const data = await fetchDashboard(session, region);
    recordSnapshot(context, data.summary.usedCredits, data.summary.remainCredits);
    data.nickname = session.nickname;
    attachAccounts(data, accountList, activeId);

    currentData = data;
    renderToTarget(context, data);
    updateStatusBar(data);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const data = createUnauthorizedData(region);
    data.authorized = true;
    data.error = reason;
    data.notice = `读取实时数据失败：${reason}`;
    data.nickname = session.nickname;
    attachAccounts(data, accountList, activeId);
    currentData = data;
    renderToTarget(context, data);
    updateStatusBar(data);
    void vscode.window.showErrorMessage(`WorkBuddy 积分看板加载失败：${reason}`);
  }
}

function updateStatusBar(data: DashboardData): void {
  const platform = data.region === 'global' ? 'CodeBuddy' : 'WorkBuddy';
  if (!data.authorized) {
    statusBar.text = `$(graph) ${platform} 未授权`;
    statusBar.tooltip = `点击打开看板并登录 ${platform} 账号`;
    return;
  }
  statusBar.text = `$(graph) ${platform} ${formatCompact(data.summary.remainCredits)}`;
  const tooltip = [`${platform} 积分看板`];
  if (data.nickname) {
    tooltip.push(`账号：${data.nickname}`);
  }
  tooltip.push(
    `剩余：${data.summary.remainCredits}`,
    `已用：${data.summary.usedCredits}`,
    '点击查看完整看板'
  );
  statusBar.tooltip = tooltip.join('\n');
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}
