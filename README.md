# WorkBuddy / CodeBuddy Credit Dashboard

**不用离开编辑器，随时掌握你的 WorkBuddy / CodeBuddy 积分。**

一个 VS Code / CodeBuddy 编辑器扩展，在侧边栏可视化展示积分余额、每日消耗明细与签到状态。所有数据都来自官方接口，真实、不造假。同一个扩展同时服务于 WorkBuddy 和 CodeBuddy：每个账号独立保存登录态，在账号下拉中切换即可，多个账号可以同时保存。

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](https://github.com/yangbaichao/credits_buddy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.75-blueviolet.svg)](https://code.visualstudio.com/)

![功能演示](media/demo.gif)

![看板界面](media/screenshot-dashboard.png)

## 为什么需要它

WorkBuddy 和 CodeBuddy 的积分、额度和签到信息散落在网页里。这个插件把它搬进你每天待着的编辑器：写代码的同时，状态栏就能看到剩余积分，侧边栏点开就能看余额、查消耗、一键签到——不用再切浏览器、不用再登网页。无论你使用哪个平台，都只需安装这一个插件；多个账号也能同时保存，在账号下拉里一点即切。

## 功能亮点

- **一眼看清积分**：总额度 / 已用 / 剩余，配环形可视化图；状态栏常驻剩余积分。
- **消耗明细可下钻**：柱状图展示每日消耗，点击任意柱子展开当天每一笔请求的时间、模型、内容摘要与积分数；支持今天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 自定义范围。
- **签到不切窗口**：看板内直接完成今日签到，按钮靠右、状态清晰。
- **多账号自由切换**：已登录账号名的下拉可切换账号、登录其他账号、重新授权、退出账号或退出全部；每个账号独立保存登录态。
- **一次授权，长期复用**：官方网页 OAuth 登录，令牌存入 SecretStorage 并做本地备份；需要时可一键退出。
- **按你的习惯排布**：卡片可拖拽排序，顺序本地保存；自动刷新间隔可配置或关闭。
- **真实数据**：不含任何演示数据；接口失败时明确提示，不伪造数值。

## 安装

从 VSIX 安装：

1. 在 [GitHub Releases](https://github.com/yangbaichao/credits_buddy/releases) 下载最新的 `.vsix`（或从源码执行 `npm run package` 生成）。
2. 在编辑器扩展视图选择「从 VSIX 安装」，或命令行：

```powershell
& "C:\...\CodeBuddy CN\bin\code.cmd" --install-extension .\workbuddy-credit-dashboard-0.1.2.vsix
```

安装后点击活动栏的「WorkBuddy 积分看板」图标，按提示完成一次授权即可。

## 多账号使用

看板顶部的账号名已改为下拉菜单：

- 选择已保存账号：立即切换到该账号的积分看板；
- `＋ 登录其他账号`：按当前设置对应的服务地址走官方 OAuth，成功后自动添加并切换过去；
- `↻ 重新授权当前账号`：覆盖当前账号的本地令牌，激活状态不变；
- `× 退出当前账号`：删除该账号的本地登录信息并切到下一个账号；
- `× 退出全部账号`：清空所有账号的本地登录信息。

## 隐私与安全

- 访问令牌仅保存在本机编辑器的 SecretStorage，并写入扩展私有存储作为备份；不写入明文配置、不上传到任何第三方服务器。
- 所有数据直接通过 WorkBuddy / CodeBuddy 官方接口读取；除「手动签到」外，扩展不会执行任何写操作。
- 若浏览器已登录 WorkBuddy / CodeBuddy 导致授权页不再弹扫码，可在无痕窗口打开授权链接重新扫码确认。

## 数据源

扩展通过官方网页 OAuth 获取访问令牌，请求域名由当前设置决定（`cn` → `www.workbuddy.cn`，`global` → `www.codebuddy.cn`），新增后会保存在账号自身信息中：

1. `POST /v2/plugin/auth/state?platform=workbuddy` 获取授权地址
2. 在浏览器完成登录后，`GET /v2/plugin/auth/token?state=...` 换取令牌
3. 使用令牌调用：

   - `POST /billing/meter/get-user-resource-summary`（积分余额摘要）
   - `POST /v2/billing/meter/checkin-activity-status`（签到状态）
   - `POST /billing/meter/get-user-request-usage`（消耗明细，按天聚合）
   - `POST /v2/billing/meter/get-user-resource`（额度包明细，当前模块暂隐藏）

区域设置：

- `cn`（默认）：WorkBuddy → `www.workbuddy.cn`
- `global`：CodeBuddy → `www.codebuddy.cn`

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `workbuddyCredit.region` | `cn` | 新增账号使用的服务地址：`cn` = `www.workbuddy.cn`，`global` = `www.codebuddy.cn`；已保存账号不受影响 |
| `workbuddyCredit.refreshInterval` | `5` | 自动刷新间隔（分钟），0 为关闭 |

## 本地开发

```bash
npm install
npm run compile
```

在 VS Code / CodeBuddy 中打开本目录，按 `F5` 启动 Extension Development Host，命令面板执行 `WorkBuddy: 打开积分看板`。

打包：`npm run package`，生成 `workbuddy-credit-dashboard-0.1.2.vsix`。

## 已知限制

- OAuth 授权需要用户在浏览器完成一次登录，后续会话会自动复用
- 消耗明细接口对单次查询时间跨度有上限（超过约 31 天返回空），扩展内部已按 30 天分段查询后合并，用户无感知
- 「额度包明细」模块暂时隐藏，相关代码保留以便后续恢复

## 许可证

[MIT](LICENSE)
