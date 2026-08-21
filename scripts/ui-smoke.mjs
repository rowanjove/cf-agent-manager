import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, Menu, session } from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function reply(channel, data) {
  ipcMain.handle(channel, () => ({ ok: true, data }));
}

app.whenReady().then(async () => {
Menu.setApplicationMenu(null);
session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
  responseHeaders: {
    ...details.responseHeaders,
    "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'"],
  },
}));

reply("settings:get", { language: "zh-CN" });
reply("accounts:list", []);
reply("resources:list", []);
reply("projects:list", []);
reply("activity:list", []);
reply("accounts:syncStatus", null);
reply("app:version", "smoke");

const window = new BrowserWindow({
  width: 1280,
  height: 800,
  show: false,
  backgroundColor: "#f5f6f8",
  webPreferences: {
    preload: path.join(root, "out", "preload", "index.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  },
});
window.webContents.on("console-message", (_event, details) => {
  if (details.level === "error") errors.push(details.message);
});
window.webContents.on("render-process-gone", (_event, details) => errors.push(`renderer:${details.reason}`));
await window.loadFile(path.join(root, "out", "renderer", "index.html"));
await new Promise((resolve) => setTimeout(resolve, 250));

const overview = await window.webContents.executeJavaScript(`(() => {
  const app = document.querySelector('#app');
  const sidebar = document.querySelector('.sidebar');
  const intro = document.querySelector('.overview-intro');
  return {
    bridge: typeof window.cfAgent === 'object',
    appDisplay: getComputedStyle(app).display,
    sidebarBackground: getComputedStyle(sidebar).backgroundColor,
    introBackground: getComputedStyle(intro).backgroundColor,
    navCount: document.querySelectorAll('[data-view]').length,
    title: document.querySelector('.topbar h1')?.textContent,
  };
})()`);

if (!overview.bridge || overview.appDisplay !== "grid" || overview.navCount < 6 || !overview.title) {
  errors.push(`invalid overview: ${JSON.stringify(overview)}`);
}
for (const view of ["resources", "projects", "deploy", "activity", "settings", "overview"]) {
  const rendered = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-view="${view}"]')?.click();
    return { title: document.querySelector('.topbar h1')?.textContent, content: document.querySelector('.content')?.textContent?.trim().length ?? 0 };
  })()`);
  if (!rendered.title || rendered.content < 2) errors.push(`view ${view} did not render`);
}

if (Menu.getApplicationMenu() !== null) errors.push("application menu is present");
window.destroy();
if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(overview)}\nUI smoke passed\n`);
}
app.exit(process.exitCode ?? 0);
}).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
});
