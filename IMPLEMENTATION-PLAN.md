# R4 落地方案与当前状态

## 架构裁决

1. Cloudflare API 是远端事实来源；SQLite 仅存缓存、本地关系和审计。
2. Project 与 Cloudflare Resource 分离；资源唯一键为 `(account_id, kind, remote_id)`。
3. 每种服务通过独立 Adapter 暴露实际 capability，不提供万能 patch。
4. 每个 Adapter 独立同步和提交；失败的 Adapter 不执行 `remote_missing`，因此 API 故障不会被误判为删除。
5. 所有写能力先分类 risk，再由 Policy Engine 判定 allow / confirm / deny。确认令牌绑定 initiator、action、target、payload hash 与有效期，并且只能使用一次。
6. Renderer 只调用白名单 preload API；不访问文件系统、Cloudflare 或 credential。

## 已落地：Control Plane Foundation（对应 PR-01～PR-07 的纵向最小集）

- Electron 41.10.6 / TypeScript strict / electron-vite 单包工程。R4 示例锁定的 37.2.6 已命中公开高危公告，因此这里按安全模型升级到当前审计无已知漏洞的修复版本；sidecar Node 与 Electron 主进程运行时仍保持隔离。
- `nodeIntegration=false`、`contextIsolation=true`、sandbox preload、CSP、外链 host 白名单。
- `node:sqlite` WAL 状态层；Account、Project、Resource、Link、Sync Run、Activity 表。
- keytar / Windows Credential Manager；Token 不可从 renderer 读回。
- Cloudflare REST client：超时、401/403/429、envelope error 映射。
- Pages、Workers、D1、KV、R2、Zone、DNS read adapters；metadata allowlist 避免秘密或大 payload 落库。
- 并行 partial sync、external 自动发现、managed ownership 保留、remote missing 非物理删除。
- 缓存优先 Dashboard、Inventory、Projects、Activity、Settings onboarding。
- 默认中文界面、设置页即时切换 English，并通过 `settings_meta` 持久化语言偏好。
- 原创应用图标覆盖 Renderer 品牌区、Electron 窗口及 Windows EXE；打包仅关闭签名，不跳过图标和版本资源写入。
- Policy 与一次性确认 grant；Resource adopt 已走完整策略路径。
- Adapter、Sync、Policy、State、IPC 契约测试。
- PR-08 第一段已完成：Windows 路径策略、realpath/长路径归一化、静态 HTML 与 Vite/React/Vue 分析、包管理器优先级、只读 Vite `outDir` 解析、YAML 构建覆盖和双语部署向导。
- PR-08 第二段核心已完成：主进程原生确认、本地依赖安装与构建、敏感环境变量清理、十分钟超时、输出目录 containment 与 `index.html` 校验。静态站点跳过构建直接校验。
- 修复沙箱 preload 的 ESM/CJS 格式冲突与开发 CSP 样式阻断；默认应用菜单已移除，界面完成高对比度与紧凑布局优化。

## Gate A：真实 Cloudflare capability spike（下一步，阻断远端写）

必须使用隔离测试账户验证并记录：

- Token 权限矩阵与缺权限错误形态。
- Pages project create/get、Direct Upload、custom domain POST body、DNS 自动 CNAME 竞态。
- Workers Wrangler vs REST 的 deploy / settings / routes 边界。
- D1/KV/R2/Zones 的分页和 jurisdiction 特例。
- DNS 多 Zone 规模下的同步成本；必要时改为 Zone targeted/lazy record sync。

产物：`docs/cloudflare-capability-matrix.md`、脱敏 fixture、可选 `CF_AGENT_E2E=1` 测试。Gate 未通过前不启用写按钮。

## Gate B：Pages 完整部署链路（PR-08～PR-11）

按顺序实现：路径白名单与 analyzer → bundled npm build → deploy lock → Pages create/read → Wrangler Direct Upload → targeted sync → domain state machine → HTTP verify。远端主体成功而域名/验证失败必须记录为 structured partial deployment。

当前路径白名单、analyzer、本地构建执行器与输出目录验证已通过。开发环境可使用已安装包管理器；绿色包会在 sidecar Node/npm 不存在时明确拒绝构建，不回退到不可控的系统运行时。下一子 Gate 是固定版本 sidecar Node/npm、构建日志落盘与 deploy lock。

## Gate C：Windows 绿色包（PR-12）

- 下载并校验固定版本 Node 22 win-x64 sidecar。
- 在 `resources/wrangler` 安装锁定的 Wrangler 4 完整依赖树。
- keytar 与 Electron ABI 冒烟；若 `node:sqlite` 在目标 Electron 的 WAL/upsert spike 失败，立即切换隔离的 `better-sqlite3` state 实现。
- 无 Node/npm/Wrangler/Git 的 Windows x64 VM 执行启动、同步、Pages fixture deploy 验收。

## Gate D：服务扩展

Workers deploy/manage → bindings/secrets/logs → D1/KV/R2 write → DNS CRUD。每项严格遵循 `API spike → list/get → sync tests → write → policy → UI`，不允许绕过 Policy 直接暴露 REST。
