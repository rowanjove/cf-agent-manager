import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, Menu, session } from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "docs", "images");

app.disableHardwareAcceleration();

function reply(channel, data) {
  ipcMain.handle(channel, () => ({ ok: true, data }));
}

await fs.mkdir(output, { recursive: true });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'"],
    },
  }));

  reply("settings:get", { language: "zh-CN" });
  reply("accounts:list", []);
  reply("resources:list", []);
  reply("projects:list", []);
  reply("activity:list", []);
  reply("accounts:syncStatus", null);
  reply("app:version", "0.2.0");

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
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

  await window.loadFile(path.join(root, "out", "renderer", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const captures = [
    ["overview", null],
    ["resources", "resources"],
    ["deploy", "deploy"],
  ];
  for (const [name, view] of captures) {
    if (view) {
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-view="${view}"]')?.click();
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const image = await window.webContents.capturePage();
    await fs.writeFile(path.join(output, `${name}.png`), image.toPNG());
  }

  window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
});
