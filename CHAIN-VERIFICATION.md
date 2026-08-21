# 链路检查结果

检查日期：2026-08-22

| 链路 | 结果 | 验证方式 / 边界 |
|---|---|---|
| Electron 启动、生产 Renderer、CSP | 通过 | `npm run smoke:ui` 加载生产构建产物，无 console error |
| Sandbox preload 与 IPC bridge | 通过 | smoke 确认 `window.cfAgent` 可用，preload 输出为 CJS |
| 页面路由与基础渲染 | 通过 | smoke 遍历概览、资源、项目、部署、活动、设置 |
| 默认菜单移除 | 通过 | smoke 确认 application menu 为 `null` |
| 中文默认与 English 切换 | 通过 | i18n、SQLite 设置持久化测试 |
| SQLite 资源缓存与状态保留 | 通过 | WAL 状态层、managed ownership、remote missing 测试 |
| Policy 一次性确认 | 通过 | action/target/payload/initiator 绑定及重放拒绝测试 |
| Cloudflare Token 请求与账户分页 | 合约通过 | mock HTTP 验证 Authorization、分页、401/403/429 映射；未使用真实 Token |
| Cloudflare 资源 Adapter | 合约通过 | Pages、Workers、D1、KV、R2、Zone、DNS normalize/capability 与 partial sync 测试 |
| 本地路径与项目分析 | 通过 | 保护目录、containment、静态站点、Vite/React/Vue、YAML/outDir 测试 |
| 本地构建执行器 | 通过 | 实际启动本地子进程并回收输出；安装/构建/产物链路使用隔离 runner 测试 |
| 敏感构建环境清理 | 通过 | Cloudflare、Token、Secret、AWS credential 等变量过滤测试 |
| Windows x64 绿色包 | 通过 | Electron native dependency rebuild、ASAR、图标资源、ZIP 打包成功 |
| Windows Credential Manager 真机写入 | 未执行 | 为避免修改当前用户凭据，仅验证 keytar native module 构建；连接真实账户时验证 |
| 绿色包 sidecar Node/npm | 未完成 | sidecar 尚未入包；打包态会明确拒绝构建，不回退到系统 npm |
| Pages Direct Upload / 域名 / DNS 写入 | 未实现 | 受设计 Gate A/B 阻断，必须先用隔离 Cloudflare 测试账户做 capability spike |

执行命令：

```powershell
npm run typecheck
npm test
npm run smoke:ui
npm audit --omit=dev
npm run pack:win
```
