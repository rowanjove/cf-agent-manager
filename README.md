# CF Nexarch

[简体中文](README.md) | [English](README.en.md)

CF Nexarch 是面向 Windows 的本地 Cloudflare 控制台。它在一个 Electron 界面中提供账户资源发现、缓存总览、本地项目组织，以及带明确确认步骤的 Pages 部署流程。

[下载 Windows 版](https://github.com/rowanjove/cf-nexarch/releases) · [报告问题](https://github.com/rowanjove/cf-nexarch/issues)

当前版本为 **0.2.0，开源早期预览**。界面默认中文，可切换 English。资源管理和部署能力仍有边界，请先阅读下方说明。

![CF Nexarch 账户资源总览](docs/images/overview.png)

## 功能与边界

| 功能 | 当前范围 |
| --- | --- |
| 资源发现 | Pages、Workers、D1、KV、R2、Zones 和 DNS |
| 缓存总览 | 本地 SQLite 保存资源缓存；单个服务同步失败不清除其他服务的成功结果 |
| 项目管理 | 创建本地 Project、确认资源纳管并记录活动 |
| 部署准备 | 选择目录、分析项目、本地构建校验和执行前确认 |
| Pages Direct Upload | 开发环境支持二次确认；拒绝覆盖 Git 管理或未纳管的同名项目 |
| 发布包部署工具 | 尚未内置独立 Node/Wrangler sidecar，也未完成干净 Windows 机器端到端部署验收 |
| 其他云端写操作 | 不应视为已交付的完整 Cloudflare 管理能力 |

公开 ZIP 不是完整部署工具链。未满足条件的操作会被明确拒绝；开发环境支持 Direct Upload 不代表发布包已经通过端到端部署验收。

![CF Nexarch 资源清单](docs/images/resources.png)
![CF Nexarch 部署向导](docs/images/deploy.png)

## 安装与升级

1. 从 [Releases](https://github.com/rowanjove/cf-nexarch/releases) 下载 `CF-Nexarch-0.2.0-windows-x64.zip`。
2. 完整解压 ZIP，运行 `CF Nexarch.exe`。
3. 在“设置”中配置 Cloudflare API Token，连接账户并同步资源。
4. 在总览和资源页检查缓存结果；执行纳管或部署操作前核对目标和确认提示。

当前发布包未签名，Windows 可能显示 SmartScreen 提示。请只使用本仓库 Release 中的资产，并用同页 `SHA256SUMS.txt` 核验文件。

从旧版 CF Agent Manager 升级时无需重新配置账户：CF Nexarch 继续使用旧版应用数据目录、应用 ID 和 Windows Credential Manager 凭据标识。

## 凭据与权限

API Token 存储在 Windows Credential Manager，不写入 SQLite、活动日志、项目文件或构建子进程环境。Renderer 不直接访问文件系统、Cloudflare API 或凭据。

请使用满足操作需求的最小权限 Token。不要在 Issue、截图、日志、测试数据或提交中包含真实凭据。资源可见不代表应用具有修改该资源的权限。

## 本地开发

需要 Windows 和 Node.js **>=22.14**。

```powershell
git clone https://github.com/rowanjove/cf-nexarch.git
cd cf-nexarch
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

测试替身和无凭据 UI 测试不能代替真实账户权限核验或干净机器上的发布验收。

## 代码与项目文档

- `src/main/`、`src/preload/`：主进程、安全策略和受限 IPC
- `src/renderer/`：界面与本地化
- `src/core/`：领域模型、同步、策略和部署分析
- `src/providers/cloudflare/`：API Client 与资源适配器
- `tests/`：Vitest 单元和集成测试

[产品约束](DESIGN-R4.md) · [实施计划](IMPLEMENTATION-PLAN.md) · [历史链路验证记录](CHAIN-VERIFICATION.md)

验证记录有独立日期，不能代替当前版本状态。涉及凭据、Cloudflare 写操作、DNS 或破坏性动作的贡献，应说明权限边界、确认流程和测试覆盖。

## 许可

本项目采用 [MIT License](LICENSE)。Electron、Cloudflare API 及其他依赖仍受各自许可证约束。
