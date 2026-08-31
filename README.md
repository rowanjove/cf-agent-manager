# CF Agent Manager

[简体中文](README.md) | [English](README.en.md)

CF Agent Manager 是面向 Windows 的 Cloudflare 资源管理桌面应用。它在一个 Electron 界面中提供账户资源发现、本地缓存总览、项目与资源关联，以及带确认步骤的部署校验。

[下载 Windows 版](https://github.com/rowanjove/cf-agent-manager/releases) · [报告问题](https://github.com/rowanjove/cf-agent-manager/issues)

当前版本为 **0.1.1，早期公开预览**。界面默认中文，可切换 English。资源管理和部署能力仍有边界，请先阅读下方说明。

![CF Agent Manager 账户资源总览](docs/images/overview.png)

## 功能与边界

| 功能 | 当前范围 |
| --- | --- |
| 资源发现 | Pages、Workers、D1、KV、R2、Zones 和 DNS |
| 缓存总览 | 本地 SQLite 保存资源缓存；单个服务同步失败不清除其他服务已成功缓存的数据 |
| 项目管理 | 创建本地项目、确认资源纳管、记录活动 |
| 部署准备 | 选择目录、分析项目、本地构建校验及执行前确认 |
| Pages Direct Upload | 开发环境支持二次确认；拒绝覆盖 Git 管理或未纳管的同名项目 |
| 发布包构建／部署 | sidecar Node/Wrangler 打包和干净 Windows 机器验收尚未完成 |
| 其他云端写操作 | 不应视为已交付的完整 Cloudflare 管理能力 |

公开 ZIP 不等于完整部署工具链。未满足条件的操作会被拒绝；不能将开发环境的 Direct Upload 支持理解为发布包已通过端到端部署验收。

![CF Agent Manager 资源管理界面](docs/images/resources.png)
![CF Agent Manager 部署准备界面](docs/images/deploy.png)

## 安装与首次使用

1. 从 [Releases](https://github.com/rowanjove/cf-agent-manager/releases) 下载 `CF-Agent-Manager-0.1.1-windows-x64.zip`。
2. 完整解压 ZIP，运行 `CF Agent Manager.exe`。
3. 在“设置”中配置 Cloudflare API Token，连接账户并同步资源。
4. 在总览和资源页查看缓存结果；执行纳管或部署相关操作前核对目标与确认提示。

当前发布包未签名，Windows 可能显示 SmartScreen 提示。请只使用本仓库 Release 中的安装资产。

## 凭据与权限

API Token 存储在 Windows Credential Manager，不写入 SQLite、活动日志、项目 YAML 或构建子进程环境。界面语言偏好与资源缓存保存在本地 SQLite。

使用满足操作需求的最小权限 Token。不要在 Issue、截图、日志、测试数据或提交中包含真实凭据。查看资源和执行云端写操作需要的权限不同，界面中出现某个资源并不代表允许修改它。

## 本地开发

需要 Windows 和 Node.js **>=22.14**。

```powershell
git clone https://github.com/rowanjove/cf-agent-manager.git
cd cf-agent-manager
npm ci
npm test
npm run typecheck
npm run dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建 Electron 主进程、preload 和 renderer |
| `npm run smoke:ui` | 构建并运行无凭据 UI 冒烟测试 |
| `npm run pack:win` | 生成 Windows x64 ZIP |

测试替身和无凭据 UI 测试不能替代真实账户权限或干净机器上的发布验收。

## 代码与项目文档

- `src/main/`、`src/preload/`：主进程、安全策略和受限 IPC。
- `src/renderer/`：界面与本地化。
- `src/core/`：领域模型、同步、策略和部署分析。
- `src/providers/cloudflare/`：API 客户端与资源适配器。
- `tests/`：Vitest 单元与集成测试。

[产品约束](DESIGN-R4.md) · [实施计划](IMPLEMENTATION-PLAN.md) · [历史链路验证记录](CHAIN-VERIFICATION.md)

验证记录有独立日期，不能代替当前版本状态。涉及凭据、Cloudflare 写操作、DNS 或破坏性动作的贡献，应说明权限边界、确认流程及测试覆盖。

## 许可

自有代码采用 [MIT License](LICENSE)。Electron 及其他依赖仍受各自许可证约束。
