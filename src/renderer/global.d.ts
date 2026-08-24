import type { AccountRecord, ActivityRecord, ProjectRecord, ResourceRecord, SyncResult } from "../core/domain";
import type { BuildResult } from "../core/deployment/build-engine";
import type { PagesDeployResult } from "../core/deployment/pages-deploy-engine";
import type { InspectResult } from "../core/deployment/local-analyzer";

interface CfAgentApi {
  accounts: {
    list(): Promise<AccountRecord[]>;
    discover(token: string): Promise<Array<{ id: string; name: string }>>;
    connect(input: { token: string; remoteAccountId: string; name: string }): Promise<AccountRecord>;
    setActive(accountId: string): Promise<AccountRecord>;
    sync(): Promise<SyncResult>;
    syncStatus(): Promise<SyncResult | null>;
    onSyncProgress(listener: (event: { kind: string; state: string; count?: number }) => void): () => void;
  };
  resources: {
    list(input?: { kind?: string; ownership?: string }): Promise<ResourceRecord[]>;
    get(resourceId: string): Promise<ResourceRecord>;
    adoptConfirmation(resourceId: string): Promise<string>;
    adopt(resourceId: string, authorization: string): Promise<ResourceRecord>;
  };
  projects: {
    list(): Promise<ProjectRecord[]>;
    create(input: { name: string; description?: string | null; tags?: string[] }): Promise<ProjectRecord>;
    linkResource(input: { projectId: string; resourceId: string; role?: string | null }): Promise<unknown>;
    unlinkResource(input: { projectId: string; resourceId: string }): Promise<unknown>;
  };
  activity: { list(limit?: number): Promise<ActivityRecord[]> };
  settings: {
    get(): Promise<{ language: "zh-CN" | "en" }>;
    save(input: { language: "zh-CN" | "en" }): Promise<{ language: "zh-CN" | "en" }>;
  };
  deploy: {
    inspect(path: string): Promise<InspectResult>;
    build(path: string): Promise<BuildResult | null>;
    pages(path: string, projectName: string): Promise<PagesDeployResult | null>;
  };
  app: { version(): Promise<string>; openExternal(url: string): Promise<boolean>; pickDirectory(): Promise<string | null> };
}

declare global { interface Window { cfAgent: CfAgentApi } }
export {};
