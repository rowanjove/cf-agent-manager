import { contextBridge, ipcRenderer } from "electron";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; recoverable: boolean } };

async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const response = await ipcRenderer.invoke(channel, input) as Envelope<T>;
  if (!response.ok) throw Object.assign(new Error(response.error.message), response.error);
  return response.data;
}

contextBridge.exposeInMainWorld("cfAgent", {
  accounts: {
    list: () => invoke("accounts:list"),
    discover: (token: string) => invoke("accounts:discover", { token }),
    connect: (input: unknown) => invoke("accounts:connect", input),
    setActive: (accountId: string) => invoke("accounts:setActive", { accountId }),
    sync: () => invoke("accounts:sync"),
    syncStatus: () => invoke("accounts:syncStatus"),
    onSyncProgress: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on("sync:progress", handler);
      return () => ipcRenderer.removeListener("sync:progress", handler);
    },
  },
  resources: {
    list: (input: unknown = {}) => invoke("resources:list", input),
    get: (resourceId: string) => invoke("resources:get", { resourceId }),
    adoptConfirmation: (resourceId: string) => invoke("resources:adoptConfirmation", { resourceId }),
    adopt: (resourceId: string, authorization: string) => invoke("resources:adopt", { resourceId, authorization }),
  },
  projects: {
    list: () => invoke("projects:list"),
    create: (input: unknown) => invoke("projects:create", input),
    linkResource: (input: unknown) => invoke("projects:linkResource", input),
    unlinkResource: (input: unknown) => invoke("projects:unlinkResource", input),
  },
  activity: { list: (limit = 100) => invoke("activity:list", { limit }) },
  settings: {
    get: () => invoke("settings:get"),
    save: (input: unknown) => invoke("settings:save", input),
  },
  deploy: {
    inspect: (path: string) => invoke("deploy:inspect", { path }),
    build: (path: string) => invoke("deploy:build", { path }),
  },
  app: {
    version: () => invoke("app:version"),
    openExternal: (url: string) => invoke("app:openExternal", { url }),
    pickDirectory: () => invoke("app:pickDirectory"),
  },
});
