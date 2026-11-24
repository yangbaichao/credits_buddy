import * as vscode from 'vscode';
import { AuthSession } from './types';
import { requestJson } from './http';

const SECRET_KEY = 'workbuddy-credit.session';

export function domainForRegion(region: string): string {
  return region === 'global' ? 'www.codebuddy.cn' : 'www.workbuddy.cn';
}

const BACKUP_KEY = 'workbuddy-credit.session.backup';

function nicknameFromToken(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '';
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    payload += '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const obj = JSON.parse(decoded);
    return String(obj.nickname ?? obj.preferred_username ?? obj.name ?? '');
  } catch {
    return '';
  }
}

function fillNickname(session: AuthSession): AuthSession {
  if (!session.nickname && session.accessToken) {
    const nick = nicknameFromToken(session.accessToken);
    if (nick) {
      return { ...session, nickname: nick };
    }
  }
  return session;
}

function usable(session: AuthSession | undefined): boolean {
  return Boolean(session && typeof session.accessToken === 'string' && session.accessToken.length > 20);
}

export async function loadSession(context: vscode.ExtensionContext): Promise<AuthSession | undefined> {
  // 备份（globalState）优先：它由 saveSession 双写，且可被可靠读取；
  // SecretStorage 在部分 fork 里可能残留旧值或读取失败。
  const backup = context.globalState.get<string>(BACKUP_KEY);
  if (backup) {
    try {
      const parsed = fillNickname(JSON.parse(backup) as AuthSession);
      if (usable(parsed)) {
        return parsed;
      }
    } catch {
      // fall through to secrets
    }
  }
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) {
    try {
      const parsed = fillNickname(JSON.parse(stored) as AuthSession);
      if (usable(parsed)) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function saveSession(context: vscode.ExtensionContext, session: AuthSession): Promise<void> {
  const raw = JSON.stringify(session);
  // 双写：SecretStorage 为主，globalState 为备份（某些 fork 的 secrets 写入不可靠）
  await context.globalState.update(BACKUP_KEY, raw);
  try {
    await context.secrets.store(SECRET_KEY, raw);
  } catch (error) {
    console.error('[workbuddy-credit] secrets.store failed, using globalState backup:', error);
  }
}

export async function clearSession(context: vscode.ExtensionContext): Promise<void> {
  try {
    await context.secrets.delete(SECRET_KEY);
  } catch (error) {
    console.error('[workbuddy-credit] secrets.delete failed:', error);
  }
  await context.globalState.update(BACKUP_KEY, undefined);
}

export interface AuthorizeCallbacks {
  onUrl?: (authUrl: string) => void;
  onProgress?: (attempt: number, totalSeconds: number, code: unknown, msg: string) => void;
}

export async function authorize(region: string, callbacks: AuthorizeCallbacks = {}): Promise<AuthSession> {
  const domain = domainForRegion(region);
  console.error('[workbuddy-credit] authorize start, domain=' + domain);
  const stateResp = await requestJson(`https://${domain}/v2/plugin/auth/state?platform=workbuddy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  const state = pickString(stateResp?.data ?? stateResp, ['state']);
  const authUrl = pickString(stateResp?.data ?? stateResp, ['authUrl', 'auth_url', 'url']);
  if (!state || !authUrl) {
    throw new Error('获取授权地址失败，请稍后重试');
  }
  console.error('[workbuddy-credit] state=' + state + ' authUrl=' + authUrl);
  callbacks.onUrl?.(authUrl);

  // 打开浏览器：某些 fork（如 CodeBuddy CN）里 openExternal 返回的 Promise 可能迟迟不 resolve，
  // 若 await 会阻塞整个轮询流程，导致界面一直停在"授权中"。这里不阻塞，最多等 3 秒兜底。
  try {
    const opened = await Promise.race([
      vscode.env.openExternal(vscode.Uri.parse(authUrl)),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3000))
    ]);
    if (!opened) {
      void vscode.window.showWarningMessage('无法自动打开浏览器，请复制授权链接手动打开。', '复制链接').then((choice) => {
        if (choice) {
          void vscode.env.clipboard.writeText(authUrl);
        }
      });
    }
  } catch (error) {
    console.error('[workbuddy-credit] openExternal failed: ' + (error instanceof Error ? error.message : String(error)));
  }

  // 提示不阻塞轮询
  void vscode.window.showInformationMessage('请在浏览器中完成 WorkBuddy 登录（微信扫码并在手机上确认），扩展会自动继续。');

  const maxAttempts = 180;
  let lastCode: unknown = '';
  let lastMsg = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(2000);
    let resp: any;
    try {
      resp = await requestJson(`https://${domain}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error('[workbuddy-credit] token poll request failed at #' + attempt + ': ' + reason);
      callbacks.onProgress?.(attempt + 1, maxAttempts * 2, 'ERR', reason);
      continue;
    }

    const msg = String(resp?.msg ?? resp?.message ?? '');
    lastCode = resp?.code;
    lastMsg = msg;
    callbacks.onProgress?.(attempt + 1, maxAttempts * 2, resp?.code, msg);
    if (attempt % 5 === 0) {
      console.error(`[workbuddy-credit] token poll #${attempt}: code=${resp?.code} msg=${msg.slice(0, 40)}`);
    }

    const d = resp?.data ?? resp;
    const token = pickString(d, ['accessToken', 'access_token', 'token', 'authToken']);
    if (token) {
      console.error('[workbuddy-credit] token received after ' + attempt + ' polls');
      const uid = pickString(d, ['uid', 'userId', 'user_id', 'accountUid', 'X-Account-Uid']);
      const nickname = pickString(d, ['nickname', 'nickName', 'nick', 'userName', 'user_name', 'name']) || nicknameFromToken(token);
      return { accessToken: token, uid, domain, nickname, source: 'oauth' };
    }

    if (resp?.code === 11217) {
      continue;
    }

    if (resp?.code === 0 || resp?.data) {
      console.error('[workbuddy-credit] token response has no token, keys: ' + JSON.stringify(Object.keys(d ?? {})));
      throw new Error(`授权成功但未返回访问令牌（响应字段：${Object.keys(d ?? {}).join(', ')}）`);
    }
  }

  throw new Error(`等待授权超时（${maxAttempts * 2} 秒）。浏览器登录完成后请回到插件；若一直未成功，请检查授权页面是否用微信扫码并在手机上确认。最后状态：code=${lastCode} msg=${lastMsg}`);
}

function pickString(obj: any, keys: string[]): string {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value) {
      return value;
    }
    if (value && typeof value === 'object') {
      const nested = pickString(value, keys);
      if (nested) {
        return nested;
      }
    }
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
