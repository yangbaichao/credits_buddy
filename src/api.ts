import { requestJson } from './http';
import {
  ApiEnvelope,
  AuthSession,
  CheckinResult,
  CheckinStatus,
  CreditPackage,
  CreditSummary,
  DashboardData,
  DailyUsage
} from './types';

function authHeaders(session: AuthSession): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`
  };
  if (session.uid) {
    headers['X-Account-Uid'] = session.uid;
    headers['X-User-Id'] = session.uid;
  }
  headers['User-Agent'] = 'WorkBuddy-Credit-Dashboard/0.1';
  return headers;
}

function post(session: AuthSession, route: string, body: unknown = {}): Promise<any> {
  return requestJson(`https://${session.domain}${route}`, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify(body)
  });
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function pickValue(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

export function parseSummary(envelope: ApiEnvelope): CreditSummary {
  const d = envelope?.data ?? envelope ?? {};
  const total = num(pickValue(d, ['TotalCredits', 'totalCredits', 'total_credits', 'total', 'totalQuota']));
  const used = num(pickValue(d, ['UsedCredits', 'usedCredits', 'used_credits', 'used', 'usedQuota']));
  const remainRaw = pickValue(d, ['RemainCredits', 'remainCredits', 'remain_credits', 'remain', 'balance', 'remainQuota']);
  const remain = remainRaw !== undefined ? num(remainRaw) : Math.max(0, total - used);

  const rawPackages = pickValue(d, ['packages', 'Packages', 'resources', 'Resources', 'list', 'List', 'details']);
  const packages: CreditPackage[] = Array.isArray(rawPackages)
    ? rawPackages.map((item: any) => {
        const capacity = num(pickValue(item, ['CapacitySize', 'capacity', 'total', 'size', 'quota']));
        const usedInPackage = num(pickValue(item, ['CapacityUsed', 'used', 'usedAmount', 'consumed']));
        const remainInPackage = pickValue(item, ['CapacityRemain', 'remain', 'remainAmount', 'left']);
        const expireRaw = num(pickValue(item, ['expireAt', 'ExpireTime', 'endTime', 'CycleEndTime', 'expireTime']));
        return {
          name: String(pickValue(item, ['name', 'Name', 'productName', 'PackageName', 'title']) ?? '额度包'),
          capacity,
          used: usedInPackage,
          remain: remainInPackage !== undefined ? num(remainInPackage) : Math.max(0, capacity - usedInPackage),
          expireAt: expireRaw > 0 ? expireRaw : undefined,
          status: num(pickValue(item, ['Status', 'status']), 0) || undefined
        };
      })
    : [];

  return { totalCredits: total, usedCredits: used, remainCredits: remain, packages };
}

export function parseCheckin(envelope: ApiEnvelope | undefined): CheckinStatus | undefined {
  if (!envelope) {
    return undefined;
  }
  const d = envelope?.data ?? envelope ?? {};
  const streak = num(pickValue(d, ['streak_days', 'streakDays', 'StreakDays', 'continuousDays']));
  const total = num(pickValue(d, ['total_credits', 'totalCredits', 'TotalCredits']));
  if (!streak && !total) {
    return undefined;
  }
  return {
    streakDays: streak,
    totalCredits: total,
    checkedToday: Boolean(
      pickValue(d, [
        'today_checked_in',
        'todayCheckedIn',
        'checkedToday',
        'checked_today',
        'isChecked',
        'todayChecked'
      ])
    ),
    periodEnd: num(pickValue(d, ['end_time', 'endTime', 'endTimeMs'])) || undefined
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export async function fetchDailyUsage(session: AuthSession): Promise<DailyUsage[]> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 89);

  // 该接口对查询时间跨度有上限（超过约 31 天会直接返回空），
  // 因此按每段 30 天切片查询后合并。
  const spans: Array<{ from: Date; to: Date }> = [];
  let spanEnd = new Date(end);
  while (spanEnd.getTime() >= start.getTime()) {
    const spanStart = new Date(spanEnd);
    spanStart.setDate(spanStart.getDate() - 29);
    spans.push({ from: spanStart.getTime() < start.getTime() ? new Date(start) : spanStart, to: new Date(spanEnd) });
    spanEnd = new Date(spanStart);
    spanEnd.setDate(spanEnd.getDate() - 1);
  }

  const rows: any[] = [];
  const pageSize = 500;
  for (const span of spans) {
    for (let pageNum = 1; pageNum <= 20; pageNum++) {
      const body = {
        startTime: `${dayKey(span.from)} 00:00:00`,
        endTime: `${dayKey(span.to)} 23:59:59`,
        pageNum,
        pageSize
      };
      const response = await post(session, '/billing/meter/get-user-request-usage', body);
      const d = response?.data ?? response ?? {};
      const pageRows: any[] = Array.isArray(d?.data) ? d.data : [];
      rows.push(...pageRows);
      const total = num(d?.total);
      if (pageRows.length < pageSize || (total > 0 && rows.length >= total)) break;
    }
  }

  const buckets = new Map<string, DailyUsage>();
  for (const row of rows) {
    const rawTime = pickValue(row, ['requestTime', 'request_time', 'time']);
    if (!rawTime) continue;
    const date = String(rawTime).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const bucket = buckets.get(date) ?? { date, credits: 0, requests: 0 };
    bucket.credits += num(pickValue(row, ['credit', 'credits', 'usedCredit']));
    bucket.requests += 1;
    buckets.set(date, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchDashboard(session: AuthSession, region: string): Promise<DashboardData> {
  const fetchedAt = Date.now();
  const results = await Promise.allSettled([
    post(session, '/billing/meter/get-user-resource-summary'),
    post(session, '/v2/billing/meter/checkin-activity-status'),
    post(session, '/v2/billing/meter/get-user-resource', { ProductCode: 'p_tcaca', Status: [0, 3] }),
    fetchDailyUsage(session)
  ]);

  const notices: string[] = [];
  let summary: CreditSummary = { totalCredits: 0, usedCredits: 0, remainCredits: 0, packages: [] };
  let checkin: CheckinStatus | undefined;
  let dailyUsage: DailyUsage[] = [];

  const [summaryResult, checkinResult, resourceResult, usageResult] = results;

  if (summaryResult.status === 'fulfilled') {
    summary = parseSummary(summaryResult.value as ApiEnvelope);
  } else {
    notices.push('余额摘要接口调用失败');
  }

  if (checkinResult.status === 'fulfilled') {
    checkin = parseCheckin(checkinResult.value as ApiEnvelope);
  }

  if (usageResult.status === 'fulfilled') {
    dailyUsage = usageResult.value as DailyUsage[];
  } else {
    notices.push('每日用量接口调用失败');
  }

  if (resourceResult.status === 'fulfilled') {
    const resourceSummary = parseSummary(resourceResult.value as ApiEnvelope);
    if (!summary.totalCredits && resourceSummary.totalCredits) {
      summary = resourceSummary;
    }
    if (resourceSummary.packages.length && !summary.packages.length) {
      summary.packages = resourceSummary.packages;
    }
  } else {
    notices.push('额度明细接口调用失败');
  }

  if (!summary.totalCredits && !summary.remainCredits) {
    throw new Error(notices.join('；') || '未获取到积分数据');
  }

  return {
    source: 'live',
    authorized: true,
    fetchedAt,
    region,
    summary,
    checkin,
    dailyUsage,
    notice: notices.length ? notices.join('；') : undefined
  };
}

export async function dailyCheckin(session: AuthSession): Promise<CheckinResult> {
  try {
    const response = await post(session, '/v2/billing/meter/daily-checkin');
    const code = response?.code;
    const message = String(response?.msg ?? response?.message ?? '');
    const data = response?.data ?? {};
    if (code === 0 || response?.success === true || !message) {
      return {
        success: true,
        message: '签到成功',
        streakDays: num(pickValue(data, ['streak_days', 'streakDays', 'continuousDays'])) || undefined,
        totalCredits: num(pickValue(data, ['total_credits', 'totalCredits'])) || undefined
      };
    }
    return { success: false, message: message || '签到失败' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function createUnauthorizedData(region: string): DashboardData {
  return {
    source: 'live',
    authorized: false,
    fetchedAt: Date.now(),
    region,
    summary: { totalCredits: 0, usedCredits: 0, remainCredits: 0, packages: [] },
    dailyUsage: [],
    notice: '尚未授权，请点击下方按钮登录 WorkBuddy 账号'
  };
}
