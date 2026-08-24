import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import pino from "pino";

import { AgentCore } from "../core/agent-core";
import { toPublicError } from "../core/errors";
import { WindowsCredentialStore } from "../credentials/credential-store";
import { READ_ADAPTERS } from "../providers/cloudflare/adapters";
import { ResourceRegistry } from "../providers/cloudflare/registry";
import { StateStore } from "../state/state-store";
import { parseIpc } from "./ipc-schemas";
import { contentSecurityPolicy } from "./security";

const logger = pino({ level: process.env.CF_AGENT_LOG_LEVEL ?? "info", redact: ["token", "*.token", "authorization"] });
let state: StateStore;
let core: AgentCore;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#08111d",
    title: "CF Agent Manager",
    icon: app.isPackaged ? join(process.resourcesPath, "app-icon.png") : join(process.cwd(), "resources", "icons", "app-icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "dash.cloudflare.com" || url.hostname.endsWith(".pages.dev"));
  } catch { return false; }
}

function handle(channel: string, fn: (input: unknown) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (_event, input) => {
    try { return { ok: true, data: await fn(input) }; }
    catch (error) {
      const publicError = toPublicError(error);
      logger.warn({ channel, code: publicError.code }, "IPC operation failed");
      return { ok: false, error: publicError };
    }
  });
}

function registerIpc(): void {
  handle("accounts:list", () => core.accountsList());
  handle("accounts:discover", (input) => core.accountDiscover(parseIpc("accounts:discover", input).token));
  handle("accounts:connect", (input) => core.accountConnect(parseIpc("accounts:connect", input)));
  handle("accounts:setActive", (input) => core.accountSetActive(parseIpc("accounts:setActive", input).accountId));
  handle("accounts:sync", async () => core.sync((progress) => mainWindow?.webContents.send("sync:progress", progress)));
  handle("accounts:syncStatus", () => core.syncStatus());
  handle("resources:list", (input) => core.resourceList(parseIpc("resources:list", input ?? {})));
  handle("resources:get", (input) => core.resourceGet(parseIpc("resources:get", input).resourceId));
  handle("resources:adoptConfirmation", (input) => core.resourceAdoptConfirmation(parseIpc("resources:adoptConfirmation", input).resourceId));
  handle("resources:adopt", (input) => {
    const parsed = parseIpc("resources:adopt", input);
    return core.resourceAdopt(parsed.resourceId, parsed.authorization);
  });
  handle("projects:list", () => core.projectList());
  handle("projects:create", (input) => core.projectCreate(parseIpc("projects:create", input)));
  handle("projects:linkResource", (input) => core.projectLinkResource(parseIpc("projects:linkResource", input)));
  handle("projects:unlinkResource", (input) => core.projectUnlinkResource(parseIpc("projects:unlinkResource", input)));
  handle("activity:list", (input) => core.activityList(parseIpc("activity:list", input ?? {}).limit));
  handle("settings:get", () => core.settingsGet());
  handle("settings:save", (input) => core.settingsSave(parseIpc("settings:save", input)));
  handle("deploy:inspect", (input) => core.inspectLocal(parseIpc("deploy:inspect", input)));
  handle("deploy:build", async (input) => {
    const parsed = parseIpc("deploy:build", input);
    const english = core.settingsGet().language === "en";
    const result = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: english ? ["Cancel", "Build and validate"] : ["取消", "构建并验证"],
      defaultId: 0,
      cancelId: 0,
      title: english ? "Confirm local code execution" : "确认执行本地项目代码",
      message: english ? "Dependencies will be installed and the project build script will run" : "将安装依赖并执行项目构建脚本",
      detail: english
        ? `The command is limited to the selected directory and sensitive environment variables are removed.\n\n${parsed.path}`
        : `仅在所选目录内运行，敏感环境变量不会传入构建进程。\n\n${parsed.path}`,
      noLink: true,
    });
    if (result.response !== 1) return null;
    return core.buildLocal(parsed);
  });
  handle("deploy:pages", async (input) => {
    const parsed = parseIpc("deploy:pages", input);
    const english = core.settingsGet().language === "en";
    const result = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: english ? ["Cancel", "Deploy to Cloudflare Pages"] : ["取消", "部署到 Cloudflare Pages"],
      defaultId: 0,
      cancelId: 0,
      title: english ? "Confirm Cloudflare write" : "确认写入 Cloudflare",
      message: english ? "This will create or update a live Pages deployment" : "这将创建或更新线上 Pages 部署",
      detail: `${parsed.projectName}\n\n${parsed.path}`,
      noLink: true,
    });
    if (result.response !== 1) return null;
    return core.deployPages(parsed);
  });
  handle("app:version", () => app.getVersion());
  handle("app:openExternal", async (input) => {
    const url = typeof input === "object" && input !== null && "url" in input ? String(input.url) : "";
    if (!isSafeExternalUrl(url)) throw new Error("INPUT_INVALID");
    await shell.openExternal(url);
    return true;
  });
  handle("app:pickDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  void app.whenReady().then(() => {
    if (app.isPackaged) process.env.CF_AGENT_PACKAGED_RUNTIME_REQUIRED = "1";
    Menu.setApplicationMenu(null);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [contentSecurityPolicy(!app.isPackaged)],
        },
      });
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    state = new StateStore(join(app.getPath("userData"), "state.db"));
    core = new AgentCore(state, new WindowsCredentialStore(), new ResourceRegistry(READ_ADAPTERS));
    registerIpc();
    createWindow();
    if (state.getActiveAccount()) void core.sync().catch((error) => logger.warn({ code: toPublicError(error).code }, "Startup sync failed"));
    const syncTimer = setInterval(() => {
      if (state.getActiveAccount()) void core.sync().catch((error) => logger.warn({ code: toPublicError(error).code }, "Scheduled sync failed"));
    }, 60_000);
    syncTimer.unref();
  });
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => state?.close());
