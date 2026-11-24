# WorkBuddy Credit Dashboard

一个 VS Code / CodeBuddy 编辑器扩展，在编辑器内可视化展示 WorkBuddy 积分余额、额度消耗与签到状态。

## 功能

- 活动栏新增「WorkBuddy 积分」图标，点击后在左侧侧边栏显示看板
- 未授权时显示独立授权页，点击「授权登录」完成 WorkBuddy 官方网页登录；已授权后可「退出」
- 浅色主题面板，顶部显示当前登录用户名
- 积分总览卡片：总额度/已用/剩余 + 环形可视化图
- 签到状态卡片（支持手动签到）、额度包进度条
- 每日积分使用量柱状图，支持今天/昨天/近 7 天/近 30 天/本月/上月/自定义日期范围筛选
- 每日用量基于本地积分快照计算，仅展示真实数据
- 卡片可拖拽排序，顺序保存在本地
- 自动刷新（默认 5 分钟，可在设置中调整或关闭）
- 授权信息保存在 VS Code SecretStorage，不写入明文配置

## 数据源

扩展通过 WorkBuddy 官方网页 OAuth 获取访问令牌：

1. `POST /v2/plugin/auth/state?platform=workbuddy` 获取授权地址
2. 在浏览器完成登录后，`GET /v2/plugin/auth/token?state=...` 换取令牌
3. 使用令牌调用：
   - `POST /billing/meter/get-user-resource-summary`（积分余额摘要）
   - `POST /v2/billing/meter/checkin-activity-status`（签到状态）
   - `POST /v2/billing/meter/get-user-resource`（额度包明细）

区域设置：

- `cn`（默认）：`www.workbuddy.cn`
- `global`：`www.codebuddy.cn`

授权后只展示真实数据，不含任何演示数据。如果接口调用失败，看板顶部显示错误原因，不会伪造数据。

## 本地开发

```bash
npm install
npm run compile
```

在 VS Code / CodeBuddy 中打开本目录，按 `F5` 启动 Extension Development Host，命令面板执行 `WorkBuddy: 打开积分看板`。

## 打包与安装

```bash
npm run package
```

生成 `workbuddy-credit-dashboard-0.1.0.vsix`，在编辑器扩展视图中选择「从 VSIX 安装」，或命令行：

```powershell
& "C:\...\CodeBuddy CN\bin\code.cmd" --install-extension .\workbuddy-credit-dashboard-0.1.0.vsix
```

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `workbuddyCredit.region` | `cn` | 账号区域 |
| `workbuddyCredit.refreshInterval` | `5` | 自动刷新间隔（分钟），0 为关闭 |

## 已知限制

- 积分消耗趋势依赖本地快照积累，至少需要两天数据才会出现柱子
- OAuth 授权需要用户在浏览器完成一次登录，后续会话会自动复用
- 除手动签到外，扩展不会执行领取等其它写操作
