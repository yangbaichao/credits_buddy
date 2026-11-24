export type DataSource = 'live';

export interface CreditPackage {
  name: string;
  capacity: number;
  used: number;
  remain: number;
  expireAt?: number;
  status?: number;
}

export interface CreditSummary {
  totalCredits: number;
  usedCredits: number;
  remainCredits: number;
  packages: CreditPackage[];
}

export interface CheckinStatus {
  streakDays: number;
  totalCredits: number;
  checkedToday: boolean;
  periodEnd?: number;
}

export interface CheckinResult {
  success: boolean;
  message: string;
  streakDays?: number;
  totalCredits?: number;
}

export interface DailyUsage {
  date: string;
  credits: number;
  requests: number;
}

export interface UsageSnapshot {
  date: string;
  used: number;
  remain: number;
  ts: number;
}

export interface DashboardData {
  source: DataSource;
  authorized: boolean;
  fetchedAt: number;
  region: string;
  nickname?: string;
  summary: CreditSummary;
  checkin?: CheckinStatus;
  dailyUsage: DailyUsage[];
  notice?: string;
  error?: string;
}

export interface AuthSession {
  accessToken: string;
  uid: string;
  domain: string;
  nickname?: string;
  source: 'oauth' | 'desktop';
}

export interface ApiEnvelope {
  code?: number;
  msg?: string;
  message?: string;
  data?: any;
  [key: string]: any;
}
