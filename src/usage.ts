import * as vscode from 'vscode';
import { DailyUsage, UsageSnapshot } from './types';

const SNAPSHOT_KEY = 'workbuddy-credit.snapshots';
const MAX_DAYS = 120;

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function recordSnapshot(context: vscode.ExtensionContext, used: number, remain: number): void {
  const snapshots = context.globalState.get<UsageSnapshot[]>(SNAPSHOT_KEY) || [];
  const key = dateKey(new Date());
  const snapshot: UsageSnapshot = { date: key, used, remain, ts: Date.now() };
  const index = snapshots.findIndex((item) => item.date === key);
  if (index >= 0) {
    snapshots[index] = snapshot;
  } else {
    snapshots.push(snapshot);
  }
  snapshots.sort((a, b) => a.date.localeCompare(b.date));

  const cutoff = dateKey(new Date(Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000));
  const trimmed = snapshots.filter((item) => item.date >= cutoff);
  void context.globalState.update(SNAPSHOT_KEY, trimmed);
}

export function getUsageSeries(context: vscode.ExtensionContext): DailyUsage[] {
  const snapshots = context.globalState.get<UsageSnapshot[]>(SNAPSHOT_KEY) || [];
  if (snapshots.length < 2) {
    return [];
  }

  const series: DailyUsage[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    let credits = current.used - previous.used;
    if (credits < 0) {
      credits = previous.remain - current.remain;
    }
    series.push({
      date: current.date,
      credits: Math.max(0, Math.round(credits)),
      requests: 0
    });
  }
  return series;
}
