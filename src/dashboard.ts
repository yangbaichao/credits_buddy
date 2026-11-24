import * as vscode from 'vscode';
import * as path from 'path';
import { DashboardData } from './types';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function renderDashboardHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  data: DashboardData
): string {
  const modulePath = path.join(extensionUri.fsPath, 'node_modules');
  const echartsUri = webview.asWebviewUri(vscode.Uri.file(path.join(modulePath, 'echarts', 'dist', 'echarts.min.js')));
  const flatpickrCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(modulePath, 'flatpickr', 'dist', 'flatpickr.min.css')));
  const flatpickrJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(modulePath, 'flatpickr', 'dist', 'flatpickr.min.js')));
  const zhLocaleUri = webview.asWebviewUri(vscode.Uri.file(path.join(modulePath, 'flatpickr', 'dist', 'l10n', 'zh.js')));
  const sortableUri = webview.asWebviewUri(vscode.Uri.file(path.join(modulePath, 'sortablejs', 'Sortable.min.js')));
  const nonce = getNonce();
  const csp = `default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';`;
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');

  const template = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WorkBuddy 积分看板</title>
<link rel="stylesheet" href="__FLATPICKR_CSS__">
<style>
:root {
  --bg: #f5f6f8; --card: #ffffff; --card-hover: #f7f8fa; --border: #e5e6eb;
  --text: #1d2129; --muted: #86909c; --primary: #3370ff; --green: #00b42a; --orange: #ff7d00;
  --shadow: 0 1px 3px rgba(0,0,0,.05);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; padding: 16px 18px 32px; line-height: 1.5; }
button { background: #fff; color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 11px; font-size: 12px; cursor: pointer; transition: background .15s, border-color .15s; }
button:hover { background: var(--card-hover); border-color: var(--primary); }
button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
button.primary:hover { opacity: .9; }
.hidden { display: none !important; }

.auth-page { display: flex; align-items: center; justify-content: center; min-height: 380px; padding: 20px; }
.auth-card { text-align: center; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 32px 24px; max-width: 320px; width: 100%; box-shadow: var(--shadow); }
.auth-logo { width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #3370ff, #7aa9ff); color: #fff; font-size: 28px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
.auth-card h2 { font-size: 18px; margin-bottom: 8px; }
.auth-card p { font-size: 12px; color: var(--muted); margin-bottom: 20px; line-height: 1.6; }
.auth-btn { background: var(--primary); color: #fff; border: none; padding: 10px 28px; font-size: 14px; font-weight: 600; border-radius: 6px; }
.auth-btn:hover { background: #1e5eff; border-color: #1e5eff; }
.auth-btn:disabled { background: #c9cdd4; cursor: default; }
.auth-status { display: none; margin-top: 14px; font-size: 11px; line-height: 1.6; padding: 8px 10px; border-radius: 6px; background: #f2f3f5; color: var(--muted); }
.auth-status.show { display: block; }
.auth-status.error { background: #fff0ed; color: #d0372b; }
.auth-link-box { display: flex; gap: 6px; margin-top: 10px; }
.auth-link-box.hidden { display: none; }
.auth-link-box input { flex: 1; min-width: 0; font-size: 10px; padding: 5px 6px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); }
.auth-link-box button { flex-shrink: 0; }
.auth-hint { font-size: 10px; color: var(--muted); margin-top: 14px; }

.header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px; }
.title { font-size: 18px; font-weight: 650; }
.subtitle { font-size: 11px; color: var(--muted); margin-top: 3px; }
.actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.user-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
.nickname { font-size: 13px; font-weight: 600; }
.user-hint { font-size: 11px; color: var(--muted); }
.notice { margin-bottom: 14px; padding: 9px 12px; border-radius: 6px; background: #fff7e8; border: 1px solid #ffd591; color: #a85b00; font-size: 12px; }
.notice.error { background: #ffece8; border-color: #ffccc7; color: #a8071a; }

#cards { display: flex; flex-direction: column; gap: 12px; }
.sortable-item { position: relative; }
.drag-handle { cursor: grab; color: #c9cdd4; font-size: 15px; padding: 0 4px; user-select: none; line-height: 1; }
.drag-handle:active { cursor: grabbing; }
.sortable-ghost { opacity: .35; }
.sortable-chosen { box-shadow: 0 6px 18px rgba(0,0,0,.15); }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; box-shadow: var(--shadow); }
.card h3 { font-size: 13px; font-weight: 600; color: var(--text); }
.card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }

.overview { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.overview-chart { width: 100%; height: 170px; }
.overview-stats { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; gap: 8px; }
.stat { text-align: center; background: var(--card-hover); border-radius: 8px; padding: 9px 4px; }
.stat-label { font-size: 11px; color: var(--muted); }
.stat-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
.stat-value.green { color: var(--green); }
.stat-value.orange { color: var(--orange); }

.signin-panel { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.signin-tip { font-size: 12px; color: var(--muted); flex: 1; min-width: 120px; }
.signin-action { padding: 7px 14px; font-size: 12px; border-radius: 6px; border: 1px solid var(--primary); background: var(--primary); color: #fff; font-weight: 600; white-space: nowrap; }
.signin-action:hover { background: #1e5eff; border-color: #1e5eff; }
.signin-action.done { background: #f2f3f5; border-color: var(--border); color: var(--muted); cursor: default; }
.signin-action.done:hover { background: #f2f3f5; border-color: var(--border); }

.packages { display: flex; flex-direction: column; gap: 12px; }
.pkg-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
.pkg-head .name { color: var(--text); }
.pkg-head .nums { color: var(--muted); }
.bar { height: 7px; background: #f0f1f2; border-radius: 999px; overflow: hidden; }
.bar > div { height: 100%; border-radius: 999px; background: var(--primary); }
.bar > div.warn { background: var(--orange); }

.filters { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.filter-btn { display: inline-flex; align-items: center; gap: 6px; }
.filter-btn .range-label { color: var(--text); font-weight: 600; }
.link-btn { background: none; border: none; color: var(--muted); font-size: 12px; padding: 4px 2px; }
.link-btn:hover { color: var(--primary); background: none; border: none; }
.date-input-hidden { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.quick-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; position: relative; z-index: 100000; }
.chip { padding: 3px 9px; font-size: 11px; border-radius: 999px; background: #fff; }
.chip.active { background: #e8f3ff; border-color: var(--primary); color: var(--primary); font-weight: 600; }
.chart { width: 100%; height: 200px; }
.footer { margin-top: 16px; font-size: 10px; color: var(--muted); text-align: center; }

.flatpickr-calendar { background: #fff; border: 1px solid var(--border); box-shadow: 0 6px 24px rgba(0,0,0,.12); font-family: inherit; }
.flatpickr-day.selected, .flatpickr-day.startRange, .flatpickr-day.endRange { background: var(--primary) !important; border-color: var(--primary) !important; color: #fff !important; }
.flatpickr-day.selected:hover { background: #1e5eff !important; }
.flatpickr-day.inRange { background: #e8f3ff !important; border-color: #e8f3ff !important; box-shadow: none !important; color: var(--primary) !important; }
.flatpickr-day:hover { background: var(--card-hover); }
.flatpickr-day.today { border-color: var(--primary); }
.flatpickr-months .flatpickr-month { color: var(--text); fill: var(--text); }
.flatpickr-weekday { color: var(--muted); }
.flatpickr-current-month .cur-month, .flatpickr-current-month input.cur-year { color: var(--text); }
.flatpickr-months .flatpickr-prev-month svg, .flatpickr-months .flatpickr-next-month svg { fill: var(--muted); }
@media (max-width: 380px) {
  body { padding: 12px 10px 24px; }
  .title { font-size: 16px; }
  .card { padding: 12px; }
  .overview-stats { gap: 5px; }
  .stat-value { font-size: 15px; }
  .chart { height: 180px; }
}
</style>
</head>
<body>

<div class="auth-page" id="auth-page">
  <div class="auth-card">
    <div class="auth-logo">W</div>
    <h2>登录 WorkBuddy</h2>
    <p>授权后即可查看积分余额、额度消耗、签到状态与每日用量</p>
    <button class="auth-btn" id="btn-authorize">授权登录</button>
    <div class="auth-status" id="auth-status"></div>
    <div class="auth-link-box hidden" id="auth-link-box">
      <input type="text" readonly id="auth-link-input">
      <button type="button" id="btn-copy-link">复制链接</button>
    </div>
    <div class="auth-hint">将打开浏览器完成 WorkBuddy 官方登录</div>
  </div>
</div>

<div id="main-page" class="hidden">
  <div class="header">
    <div><div class="title">WorkBuddy 积分看板</div><div class="subtitle" id="subtitle"></div></div>
    <div class="actions">
      <button id="btn-refresh">刷新</button>
      <button id="btn-logout">退出</button>
    </div>
  </div>
  <div class="user-bar">
    <div class="avatar" id="avatar">W</div>
    <span class="nickname" id="nickname">WorkBuddy 用户</span>
    <span class="user-hint">WorkBuddy 账号</span>
  </div>
  <div class="notice hidden" id="notice"></div>

  <div id="cards">
    <section class="sortable-item" data-id="overview">
      <div class="card">
        <div class="card-head"><span class="drag-handle" title="拖拽排序">⠿</span><h3>积分总览</h3></div>
        <div class="overview">
          <div id="overview-chart" class="overview-chart"></div>
          <div class="overview-stats">
            <div class="stat"><div class="stat-label">总额度</div><div class="stat-value" id="kpi-total">-</div></div>
            <div class="stat"><div class="stat-label">已使用</div><div class="stat-value orange" id="kpi-used">-</div></div>
            <div class="stat"><div class="stat-label">剩余可用</div><div class="stat-value green" id="kpi-remain">-</div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="sortable-item" data-id="checkin">
      <div class="card">
        <div class="card-head"><span class="drag-handle" title="拖拽排序">⠿</span><h3>签到状态</h3></div>
        <div class="signin-panel">
          <div class="signin-tip" id="checkin-tip">每日签到，积分天天领</div>
          <button class="signin-action" id="btn-checkin">立即签到</button>
        </div>
      </div>
    </section>

    <section class="sortable-item hidden" data-id="packages">
      <div class="card">
        <div class="card-head"><span class="drag-handle" title="拖拽排序">⠿</span><h3>额度包明细</h3></div>
        <div class="packages" id="packages"></div>
      </div>
    </section>

    <section class="sortable-item" data-id="usage">
      <div class="card" id="usage-card">
        <div class="card-head"><span class="drag-handle" title="拖拽排序">⠿</span><h3>每日积分使用量</h3></div>
        <div class="quick-row" id="quick-row">
          <button class="chip" data-range="today">今天</button>
          <button class="chip" data-range="yesterday">昨天</button>
          <button class="chip" data-range="7d">近 7 天</button>
          <button class="chip active" data-range="30d">近 30 天</button>
          <button class="chip" data-range="month">本月</button>
          <button class="chip" data-range="lastmonth">上月</button>
          <button class="chip" data-range="custom">自定义</button>
        </div>
        <div class="filters">
          <button class="filter-btn" id="btn-range">时间维度 <span id="range-label" class="range-label">近 30 天</span> <span>▾</span></button>
          <input type="text" id="date-range" class="date-input-hidden" readonly tabindex="-1">
          <button class="link-btn" id="btn-clear">清除筛选条件</button>
        </div>
        <div id="bar" class="chart"></div>
      </div>
    </section>
  </div>
  <div class="footer" id="footer"></div>
</div>

<script nonce="__NONCE__" src="__ECHARTS__"></script>
<script nonce="__NONCE__" src="__FLATPICKR_JS__"></script>
<script nonce="__NONCE__" src="__ZH_LOCALE__"></script>
<script nonce="__NONCE__" src="__SORTABLE__"></script>
<script nonce="__NONCE__" type="application/json" id="payload">__DATA__</script>
<script nonce="__NONCE__">
(function () {
  var vscode = acquireVsCodeApi();
  var sourceData = JSON.parse(document.getElementById('payload').textContent);
  var overviewChart = null;
  var barChart = null;
  var fp = null;
  var state = { start: '', end: '', preset: '30d' };
  var ORDER_KEY = 'workbuddy-card-order';

  function fmt(n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shortOf(key) { return key ? key.slice(5).replace('-', '/') : ''; }

  function initState() {
    var today = new Date();
    var start = new Date(today);
    start.setDate(start.getDate() - 29);
    state.start = keyOf(start);
    state.end = keyOf(today);
    state.preset = '30d';
  }

  function render(data) {
    sourceData = data;
    if (!data.authorized) {
      document.getElementById('auth-page').classList.remove('hidden');
      document.getElementById('main-page').classList.add('hidden');
      return;
    }
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('main-page').classList.remove('hidden');

    var s = data.summary || {};
    document.getElementById('subtitle').textContent =
      (data.region === 'global' ? '国际版' : '国内版') + ' · 更新于 ' + new Date(data.fetchedAt).toLocaleString('zh-CN');

    var nickname = data.nickname || 'WorkBuddy 用户';
    document.getElementById('nickname').textContent = nickname;
    document.getElementById('avatar').textContent = nickname.trim().charAt(0).toUpperCase() || 'W';

    var notice = document.getElementById('notice');
    var message = data.error ? ('数据加载失败：' + data.error) : data.notice;
    if (message) {
      notice.textContent = message;
      notice.className = 'notice' + (data.error ? ' error' : '');
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }

    document.getElementById('kpi-total').textContent = fmt(s.totalCredits);
    document.getElementById('kpi-used').textContent = fmt(s.usedCredits);
    document.getElementById('kpi-remain').textContent = fmt(s.remainCredits);

    var checkin = data.checkin || {};
    document.getElementById('checkin-tip').textContent = checkin.checkedToday ? '已签到，再接再厉，明天继续领积分～' : '每日签到领积分，加油再接再厉～';
    var checkinBtn = document.getElementById('btn-checkin');
    checkinBtn.textContent = checkin.checkedToday ? '今日已签到' : '立即签到';
    checkinBtn.disabled = !!checkin.checkedToday;
    checkinBtn.className = 'signin-action' + (checkin.checkedToday ? ' done' : '');

    var packages = document.getElementById('packages');
    packages.innerHTML = '';
    (s.packages || []).forEach(function (pkg) {
      var pct = pkg.capacity > 0 ? Math.min(100, Math.round(pkg.used / pkg.capacity * 100)) : 0;
      var wrap = document.createElement('div');
      var head = document.createElement('div');
      head.className = 'pkg-head';
      var name = document.createElement('span'); name.className = 'name'; name.textContent = pkg.name;
      var nums = document.createElement('span'); nums.className = 'nums'; nums.textContent = fmt(pkg.used) + ' / ' + fmt(pkg.capacity) + ' (' + pct + '%)';
      head.appendChild(name); head.appendChild(nums);
      var bar = document.createElement('div'); bar.className = 'bar';
      var fill = document.createElement('div'); fill.style.width = pct + '%';
      if (pct >= 80) fill.className = 'warn';
      bar.appendChild(fill);
      wrap.appendChild(head); wrap.appendChild(bar);
      packages.appendChild(wrap);
    });
    if (!(s.packages || []).length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:var(--muted);font-size:12px';
      empty.textContent = '暂无额度包明细';
      packages.appendChild(empty);
    }

    if (window.echarts) {
      if (!overviewChart) overviewChart = echarts.init(document.getElementById('overview-chart'), null, { renderer: 'canvas' });
      overviewChart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', backgroundColor: '#fff', borderColor: '#e5e6eb', textStyle: { color: '#1d2129', fontSize: 12 } },
        series: [{
          type: 'pie', radius: ['56%', '80%'], center: ['50%', '50%'], avoidLabelOverlap: false,
          label: { show: true, position: 'center', formatter: function () { return fmt(s.remainCredits) + '\\n剩余'; }, color: '#1d2129', fontSize: 18, fontWeight: 'bold', lineHeight: 22 },
          labelLine: { show: false },
          data: [
            { value: s.remainCredits || 0, name: '剩余', itemStyle: { color: '#00b42a' } },
            { value: s.usedCredits || 0, name: '已用', itemStyle: { color: '#3370ff' } }
          ]
        }]
      }, true);
    }

    document.getElementById('footer').textContent = '数据源：WorkBuddy 官方接口 · 本扩展仅读取展示（签到除外）';
    updateRangeLabel();
    renderBar();
  }

  function filteredUsage() {
    return (sourceData.dailyUsage || []).filter(function (d) {
      return (!state.start || d.date >= state.start) && (!state.end || d.date <= state.end);
    });
  }

  function renderBar() {
    if (!window.echarts) return;
    if (!barChart) barChart = echarts.init(document.getElementById('bar'), null, { renderer: 'canvas' });
    var items = filteredUsage();
    barChart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e5e6eb', textStyle: { color: '#1d2129', fontSize: 12 }, formatter: function (params) { var p = params[0]; return p.axisValue + '<br/>消耗积分：<b>' + p.value + '</b>'; } },
      grid: { left: 38, right: 12, top: 16, bottom: 26 },
      xAxis: { type: 'category', data: items.map(function (d) { return d.date.slice(5).replace('-', '/'); }), axisLabel: { color: '#86909c', fontSize: 10, interval: items.length > 20 ? 3 : 0 }, axisLine: { lineStyle: { color: '#e5e6eb' } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#86909c', fontSize: 10 }, splitLine: { lineStyle: { color: '#f0f1f2' } } },
      series: [{ type: 'bar', data: items.map(function (d) { return d.credits; }), barMaxWidth: 18, itemStyle: { color: '#3370ff', borderRadius: [3, 3, 0, 0] }, emphasis: { itemStyle: { color: '#1e5eff' } } }]
    }, true);
  }

  function presetRange(preset) {
    var today = new Date();
    var start = '', end = keyOf(today);
    if (preset === 'today') { start = end; }
    else if (preset === 'yesterday') { var y = new Date(today); y.setDate(y.getDate() - 1); start = end = keyOf(y); }
    else if (preset === '7d') { var s = new Date(today); s.setDate(s.getDate() - 6); start = keyOf(s); }
    else if (preset === '30d') { var s2 = new Date(today); s2.setDate(s2.getDate() - 29); start = keyOf(s2); }
    else if (preset === 'month') { start = keyOf(new Date(today.getFullYear(), today.getMonth(), 1)); }
    else if (preset === 'lastmonth') { start = keyOf(new Date(today.getFullYear(), today.getMonth() - 1, 1)); end = keyOf(new Date(today.getFullYear(), today.getMonth(), 0)); }
    return { start: start, end: end };
  }

  function highlightChip(preset) {
    var chips = document.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i].getAttribute('data-range') === preset);
  }

  function updateRangeLabel() {
    var labels = { today: '今天', yesterday: '昨天', '7d': '近 7 天', '30d': '近 30 天', month: '本月', lastmonth: '上月' };
    var label = state.preset === 'custom' ? '自定义' : (labels[state.preset] || '时间维度');
    if (state.start && state.end) label = shortOf(state.start) + ' - ' + shortOf(state.end);
    else if (state.start) label = shortOf(state.start) + ' - 选择结束日期';
    document.getElementById('range-label').textContent = label;
  }

  function applyPreset(preset) {
    if (preset === 'custom') {
      state.preset = 'custom'; highlightChip('custom'); updateRangeLabel(); fp.open(); return;
    }
    var range = presetRange(preset);
    state.start = range.start; state.end = range.end; state.preset = preset;
    fp.setDate([range.start, range.end], false);
    fp.close(); highlightChip(preset); updateRangeLabel(); renderBar();
  }

  function initPicker() {
    fp = flatpickr(document.getElementById('date-range'), {
      mode: 'range', dateFormat: 'Y-m-d', locale: 'zh',
      showMonths: window.innerWidth >= 560 ? 2 : 1,
      positionElement: document.getElementById('btn-range'),
      clickOpens: false, allowInput: false,
      onChange: function (dates) {
        if (dates.length === 2) {
          state.start = fp.formatDate(dates[0], 'Y-m-d');
          state.end = fp.formatDate(dates[1], 'Y-m-d');
          state.preset = 'custom'; highlightChip('custom'); updateRangeLabel(); renderBar();
        } else if (dates.length === 1) {
          state.start = fp.formatDate(dates[0], 'Y-m-d'); state.end = ''; updateRangeLabel();
        }
      }
    });
    fp.setDate([state.start, state.end], false);
  }

  function applyOrder() {
    try {
      var order = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
      if (!order.length) return;
      var container = document.getElementById('cards');
      order.forEach(function (id) {
        var el = container.querySelector('[data-id="' + id + '"]');
        if (el) container.appendChild(el);
      });
    } catch (e) {}
  }

  function initSortable() {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(document.getElementById('cards'), {
      handle: '.drag-handle', animation: 150,
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onEnd: function () {
        var ids = Array.prototype.map.call(document.getElementById('cards').children, function (el) { return el.getAttribute('data-id'); });
        try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch (e) {}
        if (overviewChart) overviewChart.resize();
        if (barChart) barChart.resize();
      }
    });
    applyOrder();
  }

  document.getElementById('btn-authorize').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; btn.textContent = '授权中…';
    var status = document.getElementById('auth-status');
    status.textContent = '正在打开浏览器…'; status.className = 'auth-status show';
    vscode.postMessage({ command: 'authorize' });
  });
  document.getElementById('btn-logout').addEventListener('click', function () { vscode.postMessage({ command: 'logout' }); });
  document.getElementById('btn-copy-link').addEventListener('click', function () {
    var input = document.getElementById('auth-link-input');
    input.select();
    try { document.execCommand('copy'); this.textContent = '已复制'; } catch (e) { this.textContent = '请手动复制'; }
  });
  document.getElementById('btn-range').addEventListener('click', function (e) { e.stopPropagation(); fp.open(); });
  document.getElementById('btn-clear').addEventListener('click', function () { applyPreset('30d'); });
  document.getElementById('quick-row').addEventListener('click', function (e) {
    var preset = e.target.getAttribute && e.target.getAttribute('data-range');
    if (preset) applyPreset(preset);
  });
  document.getElementById('btn-refresh').addEventListener('click', function () { vscode.postMessage({ command: 'refresh' }); });
  document.getElementById('btn-checkin').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; btn.textContent = '签到中…';
    vscode.postMessage({ command: 'checkin' });
  });
  window.addEventListener('resize', function () {
    if (overviewChart) overviewChart.resize();
    if (barChart) barChart.resize();
  });
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function () {
      if (overviewChart) overviewChart.resize();
      if (barChart) barChart.resize();
    });
    observer.observe(document.getElementById('overview-chart'));
    observer.observe(document.getElementById('bar'));
  }
  window.addEventListener('message', function (event) {
    var d = event.data;
    if (!d) return;
    if (d.type === 'update') render(d.data);
    if (d.type === 'authStatus') {
      var btn = document.getElementById('btn-authorize');
      var status = document.getElementById('auth-status');
      if (d.state === 'waiting') {
        btn.disabled = true; btn.textContent = '授权中…';
        status.textContent = d.message || '等待浏览器授权中…';
        status.className = 'auth-status show';
      } else if (d.state === 'error') {
        btn.disabled = false; btn.textContent = '重新授权';
        status.textContent = d.message || '授权失败，请重试';
        status.className = 'auth-status show error';
      } else {
        btn.disabled = false; btn.textContent = '授权登录';
        status.textContent = ''; status.className = 'auth-status';
      }
      var linkBox = document.getElementById('auth-link-box');
      if (d.authUrl) {
        linkBox.classList.remove('hidden');
        linkBox.querySelector('input').value = d.authUrl;
      }
    }
    if (d.type === 'checkinResult') {
      var btn = document.getElementById('btn-checkin');
      if (d.success) {
        btn.textContent = '今日已签到'; btn.disabled = true; btn.className = 'signin-action done';
        document.getElementById('checkin-tip').textContent = '已签到，再接再厉，明天继续领积分～';
      } else {
        btn.textContent = '重试签到'; btn.disabled = false;
        var notice = document.getElementById('notice');
        notice.textContent = '签到失败：' + d.message;
        notice.className = 'notice error';
        notice.classList.remove('hidden');
      }
    }
  });

  initState();
  initPicker();
  initSortable();
  render(sourceData);
})();
</script>
</body>
</html>`;

  return template
    .replace(/__CSP__/g, csp)
    .replace(/__NONCE__/g, nonce)
    .replace(/__ECHARTS__/g, echartsUri.toString())
    .replace(/__FLATPICKR_CSS__/g, flatpickrCssUri.toString())
    .replace(/__FLATPICKR_JS__/g, flatpickrJsUri.toString())
    .replace(/__ZH_LOCALE__/g, zhLocaleUri.toString())
    .replace(/__SORTABLE__/g, sortableUri.toString())
    .replace(/__DATA__/g, payload);
}
