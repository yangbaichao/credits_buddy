import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { AccountSession, AuthSession, Region } from './types';
import { requestJson } from './http';

const LEGACY_SECRET_KEY = 'workbuddy-credit.session';
const LEGACY_BACKUP_KEY = 'workbuddy-credit.session.backup';
const ACCOUNTS_KEY = 'workbuddy-credit.accounts';
const ACTIVE_KEY = 'workbuddy-credit.activeAccount';

type AccountMap = Record<string, AccountSession>;

export function domainForRegion(region: string): string {
  return region === 'global' ? 'www.codebuddy.cn' : 'www.workbuddy.cn';
}

export function regionForDomain(domain: string): Region {
  return domain === 'www.codebuddy.cn' ? 'global' : 'cn';
}

export function accountIdFor(session: AuthSession): string {
  const region = regionForDomain(session.domain);
  const uid = session.uid || createHash('sha256').update(session.accessToken).digest('hex').slice(0, 12);
  return `${region}:${uid}`;
}

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

function toAccountSession(session: AuthSession, previous?: AccountSession): AccountSession {
  const now = Date.now();
  return {
    ...session,
    id: accountIdFor(session),
    region: regionForDomain(session.domain),
    addedAt: previous?.addedAt ?? now,
    lastUsedAt: now
  };
}

function parseAccounts(raw: string | undefined): AccountMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as AccountMap;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: AccountMap = {};
    Object.keys(parsed).forEach((key) => {
      const item = parsed[key] as AuthSession | undefined;
      if (!item || typeof item !== 'object') return;
      const filled = fillNickname(item);
      if (!usable(filled)) return;
      result[key] = {
        ...filled,
        id: key,
        region: regionForDomain(filled.domain),
        addedAt: Number((item as AccountSession).addedAt) || Date.now(),
        lastUsedAt: Number((item as AccountSession).lastUsedAt) || Date.now()
      };
    });
    return result;
  } catch {
    return {};
  }
}

async function readAccountsRaw(context: vscode.ExtensionContext): Promise<AccountMap> {
  // 与旧的 loadSession 一致：globalState 备份优先。它在每次写入时都会更新，
  // 即使某些 fork 的 secrets.store 失败，也不会把已删除的账号读回来。
  const backupRaw = context.globalState.get<string>(ACCOUNTS_KEY);
  if (backupRaw !== undefined) {
    try {
      JSON.parse(backupRaw);
      return parseAccounts(backupRaw);
    } catch (error) {
      console.error('[workbuddy-credit] accounts backup is corrupted, falling back to secrets:', error);
    }
  }
  try {
    return parseAccounts(await context.secrets.get(ACCOUNTS_KEY));
  } catch (error) {
    console.error('[workbuddy-credit] secrets.get accounts failed:', error);
    return {};
  }
}

async function writeAccounts(context: vscode.ExtensionContext, accounts: AccountMap): Promise<void> {
  const raw = JSON.stringify(accounts);
  // 与现有单会话行为一致：SecretStorage 为主，globalState 为备份（某些 fork 的 secrets 写入不可靠）
  await context.globalState.update(ACCOUNTS_KEY, raw);
  try {
    await context.secrets.store(ACCOUNTS_KEY, raw);
  } catch (error) {
    console.error('[workbuddy-credit] secrets.store accounts failed, using globalState backup:', error);
  }
}

async function clearLegacySession(context: vscode.ExtensionContext): Promise<void> {
  try {
    await context.secrets.delete(LEGACY_SECRET_KEY);
  } catch (error) {
    console.error('[workbuddy-credit] secrets.delete legacy session failed:', error);
  }
  await context.globalState.update(LEGACY_BACKUP_KEY, undefined);
}

export async function migrateLegacySession(context: vscode.ExtensionContext): Promise<void> {
  const candidates: string[] = [];
  const backup = context.globalState.get<string>(LEGACY_BACKUP_KEY);
  if (backup) candidates.push(backup);
  try {
    const secret = await context.secrets.get(LEGACY_SECRET_KEY);
    if (secret) candidates.push(secret);
  } catch (error) {
    console.error('[workbuddy-credit] secrets.get legacy session failed:', error);
  }
  if (!candidates.length) return;

  let account: AccountSession | undefined;
  for (const raw of candidates) {
    try {
      const parsed = fillNickname(JSON.parse(raw) as AuthSession);
      if (usable(parsed)) {
        account = toAccountSession(parsed);
        break;
      }
    } catch (error) {
      console.error('[workbuddy-credit] parse legacy session failed:', error);
    }
  }
  if (!account) return;

  const accounts = await readAccountsRaw(context);
  if (!accounts[account.id]) {
    accounts[account.id] = account;
    await writeAccounts(context, accounts);
  }
  const active = context.globalState.get<string>(ACTIVE_KEY);
  if (!active || !accounts[active]) {
    await context.globalState.update(ACTIVE_KEY, account.id);
  }
  await clearLegacySession(context);
  console.error('[workbuddy-credit] migrated legacy session to accounts: ' + account.id);
}

export async function loadAccounts(context: vscode.ExtensionContext): Promise<AccountMap> {
  await migrateLegacySession(context);
  return readAccountsRaw(context);
}

export async function saveAccount(
  context: vscode.ExtensionContext,
  session: AuthSession,
  previousId?: string
): Promise<AccountSession> {
  const accounts = await loadAccounts(context);
  const previous = previousId ? accounts[previousId] : accounts[accountIdFor(session)];
  const account = toAccountSession(session, previous);
  if (previous && previous.id !== account.id) {
    delete accounts[previous.id];
  }
  accounts[account.id] = account;
  await writeAccounts(context, accounts);
  await context.globalState.update(ACTIVE_KEY, account.id);
  return account;
}

export async function setActiveAccount(context: vscode.ExtensionContext, id: string): Promise<AccountSession | undefined> {
  const accounts = await loadAccounts(context);
  if (!accounts[id]) return undefined;
  accounts[id] = { ...accounts[id], lastUsedAt: Date.now() };
  await writeAccounts(context, accounts);
  await context.globalState.update(ACTIVE_KEY, id);
  return accounts[id];
}

export async function loadActiveAccount(context: vscode.ExtensionContext): Promise<AccountSession | undefined> {
  const accounts = await loadAccounts(context);
  const id = context.globalState.get<string>(ACTIVE_KEY);
  if (id && accounts[id]) return accounts[id];
  const first = Object.values(accounts).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
  if (first) {
    await context.globalState.update(ACTIVE_KEY, first.id);
  }
  return first;
}

export async function removeAccount(context: vscode.ExtensionContext, id: string): Promise<void> {
  const accounts = await loadAccounts(context);
  if (!accounts[id]) return;
  delete accounts[id];
  const active = context.globalState.get<string>(ACTIVE_KEY);
  const next = active === id
    ? Object.values(accounts).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]?.id
    : active;
  await writeAccounts(context, accounts);
  await context.globalState.update(ACTIVE_KEY, next);
}

export async function clearAllAccounts(context: vscode.ExtensionContext): Promise<void> {
  await writeAccounts(context, {});
  await context.globalState.update(ACTIVE_KEY, undefined);
  await clearLegacySession(context);
}

// 兼容入口：旧代码仍可按单会话方式读取/写入。
export async function loadSession(context: vscode.ExtensionContext): Promise<AuthSession | undefined> {
  return loadActiveAccount(context);
}

export async function saveSession(context: vscode.ExtensionContext, session: AuthSession): Promise<void> {
  await saveAccount(context, session);
}

export async function clearSession(context: vscode.ExtensionContext): Promise<void> {
  await clearAllAccounts(context);
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
  void vscode.window.showInformationMessage('请在浏览器中完成官方登录（微信扫码并在手机上确认），扩展会自动继续。');

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
