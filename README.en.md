# CF Nexarch

[简体中文](README.md) | [English](README.en.md)

CF Nexarch is a local Cloudflare control plane for Windows. Its Electron interface combines account resource discovery, a cached dashboard, local project organization, and Pages deployment flows with explicit confirmation steps.

[Download for Windows](https://github.com/rowanjove/cf-nexarch/releases) · [Report an issue](https://github.com/rowanjove/cf-nexarch/issues)

The current version is **0.2.0, an early open-source preview**. The interface defaults to Chinese and can switch to English. Resource management and deployment support have the limits described below.

![CF Nexarch account resource dashboard](docs/images/overview.png)

## Features and current limits

| Feature | Current scope |
| --- | --- |
| Resource discovery | Pages, Workers, D1, KV, R2, Zones, and DNS |
| Cached dashboard | Local SQLite cache; a failed service sync does not discard successful results from other services |
| Project management | Local project creation, confirmed resource adoption, and activity records |
| Deployment preparation | Directory selection, project analysis, local build validation, and pre-execution confirmation |
| Pages Direct Upload | Supported in development with a second confirmation; refuses to overwrite Git-managed or unadopted projects with the same name |
| Packaged build/deployment tools | Sidecar Node/Wrangler packaging and clean Windows machine acceptance testing remain incomplete |
| Other cloud writes | Not a complete implementation of Cloudflare administration |

The public ZIP is not a complete deployment toolchain. Operations whose prerequisites are unmet are rejected. Development-mode Direct Upload support does not mean the packaged application has passed end-to-end deployment acceptance testing.

![CF Nexarch resource management screen](docs/images/resources.png)
![CF Nexarch deployment preparation screen](docs/images/deploy.png)

## Install and connect

1. Download `CF-Nexarch-0.2.0-windows-x64.zip` from [Releases](https://github.com/rowanjove/cf-nexarch/releases).
2. Extract the entire ZIP and run `CF Nexarch.exe`.
3. Configure a Cloudflare API Token in Settings, connect an account, and sync resources.
4. Inspect cached results in the dashboard and resource views. Check the target and confirmation prompt before adoption or deployment-related operations.

The current package is unsigned and may trigger Windows SmartScreen. Use only the assets published in this repository's Releases.

Upgrading from CF Agent Manager does not require reconnecting your account. CF Nexarch retains the legacy application data directory, application ID, and Windows Credential Manager service identity.

## Credentials and permissions

API Tokens are stored in Windows Credential Manager, not in SQLite, activity logs, project YAML, or build subprocess environments. Language preferences and resource caches are stored in local SQLite.

Use a Token with the minimum permissions required for your operations. Never include real credentials in issues, screenshots, logs, test fixtures, or commits. Reading resources and performing cloud writes require different permissions; visibility in the interface does not imply permission to modify a resource.

## Local development

Requires Windows and Node.js **>=22.14**.

```powershell
git clone https://github.com/rowanjove/cf-nexarch.git
cd cf-nexarch
npm ci
npm test
npm run typecheck
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the Electron main process, preload, and renderer |
| `npm run smoke:ui` | Build and run a credential-free UI smoke test |
| `npm run pack:win` | Create a Windows x64 ZIP |

Mocks and credential-free UI tests do not replace live account permission checks or packaged acceptance testing on a clean machine.

## Code and project documentation

- `src/main/`, `src/preload/`: main process, security policies, and restricted IPC.
- `src/renderer/`: interface and localization.
- `src/core/`: domain models, sync, policy, and deployment analysis.
- `src/providers/cloudflare/`: API client and resource adapters.
- `tests/`: Vitest unit and integration tests.

[Product constraints](DESIGN-R4.md) · [Implementation plan](IMPLEMENTATION-PLAN.md) · [Historical verification record](CHAIN-VERIFICATION.md)

These documents are currently in Chinese. Verification records have their own dates and are not a substitute for current release status. Contributions affecting credentials, cloud writes, DNS, or destructive operations should describe permission boundaries, confirmation flows, and test coverage.

## License

Project code is available under the [MIT License](LICENSE). Electron and other dependencies retain their respective licenses.
