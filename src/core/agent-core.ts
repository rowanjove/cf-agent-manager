import { randomUUID } from "node:crypto";

import type { ResourceKind } from "./domain";
import { AppError } from "./errors";
import { PolicyEngine } from "./policy/policy-engine";
import type { SyncProgressHandler } from "./sync/sync-engine";
import { SyncEngine } from "./sync/sync-engine";
import { inspectLocalProject } from "./deployment/local-analyzer";
import { BuildEngine } from "./deployment/build-engine";
import type { CredentialStore } from "../credentials/credential-store";
import { CloudflareClient } from "../providers/cloudflare/client/cloudflare-client";
import type { ResourceRegistry } from "../providers/cloudflare/registry";
import type { StateStore } from "../state/state-store";

export class AgentCore {
  readonly #syncEngine: SyncEngine;
  readonly #buildEngine: BuildEngine;

  constructor(
    private readonly state: StateStore,
    private readonly credentials: CredentialStore,
    registry: ResourceRegistry,
    private readonly policy = new PolicyEngine(),
    buildEngine = new BuildEngine(),
  ) {
    this.#syncEngine = new SyncEngine(state, credentials, registry);
    this.#buildEngine = buildEngine;
  }

  accountsList() { return this.state.listAccounts(); }

  async accountDiscover(token: string) {
    const client = new CloudflareClient(token);
    await client.verifyToken();
    return client.listAccounts();
  }

  async accountConnect(input: { token: string; remoteAccountId: string; name: string }) {
    const client = new CloudflareClient(input.token);
    await client.verifyToken();
    const accounts = await client.listAccounts();
    const selected = accounts.find((account) => account.id === input.remoteAccountId);
    if (!selected) throw new AppError("AUTH_FORBIDDEN", "Token does not grant access to the selected account");
    await this.credentials.saveToken(input.remoteAccountId, input.token);
    return this.state.saveAccount({ remoteAccountId: input.remoteAccountId, name: selected.name || input.name, activate: true });
  }

  accountSetActive(accountId: string) {
    const account = this.state.setActiveAccount(accountId);
    if (!account) throw new AppError("ACCOUNT_NOT_CONFIGURED", "Account not found");
    return account;
  }

  async sync(onProgress?: SyncProgressHandler) {
    const account = this.state.getActiveAccount();
    if (!account) throw new AppError("ACCOUNT_NOT_CONFIGURED", "Connect a Cloudflare account first");
    return this.#syncEngine.sync(account, onProgress);
  }

  syncStatus() {
    const account = this.state.getActiveAccount();
    return account ? this.state.getLatestSync(account.id) : null;
  }

  resourceList(input: { kind?: ResourceKind | undefined; ownership?: "managed" | "external" | undefined } = {}) {
    const account = this.state.getActiveAccount();
    return this.state.listResources({ ...(account ? { accountId: account.id } : {}), ...input });
  }

  resourceGet(resourceId: string) {
    const resource = this.state.getResource(resourceId);
    if (!resource) throw new AppError("RESOURCE_NOT_FOUND", "Resource not found");
    return resource;
  }

  resourceAdopt(resourceId: string, authorization?: string) {
    const resource = this.resourceGet(resourceId);
    const request = {
      initiator: "gui" as const, action: "resource.adopt", targetId: resource.id,
      ownership: resource.ownership, risk: "sensitive_write" as const, category: "edit" as const,
      payload: { ownership: "managed" }, ...(authorization ? { authorization } : {}),
    };
    this.policy.authorize(request);
    const updated = this.state.adoptResource(resourceId)!;
    this.state.addActivity({
      accountId: resource.accountId, initiator: "gui", action: "resource.adopt", target: resource.name,
      result: "succeeded", correlationId: `adopt_${randomUUID()}`, summary: `Adopted ${resource.kind} ${resource.name}`,
    });
    return updated;
  }

  resourceAdoptConfirmation(resourceId: string): string {
    const resource = this.resourceGet(resourceId);
    return this.policy.issueConfirmation({
      initiator: "gui", action: "resource.adopt", targetId: resource.id, ownership: resource.ownership,
      risk: "sensitive_write", category: "edit", payload: { ownership: "managed" },
    });
  }

  projectList() {
    return this.state.listProjects(this.state.getActiveAccount()?.id);
  }

  projectCreate(input: { name: string; description?: string | null | undefined; tags?: string[] | undefined }) {
    const account = this.state.getActiveAccount();
    if (!account) throw new AppError("ACCOUNT_NOT_CONFIGURED", "Connect a Cloudflare account first");
    const project = this.state.createProject({ accountId: account.id, ...input });
    this.state.addActivity({
      accountId: account.id, initiator: "gui", action: "project.create", target: project.name,
      result: "succeeded", correlationId: `project_${randomUUID()}`, summary: `Created project ${project.name}`,
    });
    return project;
  }

  projectLinkResource(input: { projectId: string; resourceId: string; role?: string | null | undefined }) {
    if (!this.state.getProject(input.projectId)) throw new AppError("INPUT_INVALID", "Project not found");
    if (!this.state.getResource(input.resourceId)) throw new AppError("RESOURCE_NOT_FOUND", "Resource not found");
    this.state.linkResource(input);
    return { projectId: input.projectId, resourceIds: this.state.listProjectResourceIds(input.projectId) };
  }

  projectUnlinkResource(input: { projectId: string; resourceId: string }) {
    this.state.unlinkResource(input.projectId, input.resourceId);
    return { projectId: input.projectId, resourceIds: this.state.listProjectResourceIds(input.projectId) };
  }

  activityList(limit = 100) { return this.state.listActivity(limit); }

  inspectLocal(input: { path: string }) {
    return inspectLocalProject(input.path, {
      allowedPaths: this.state.getSetting<string[]>("security.allowedPaths", []),
      deniedPaths: this.state.getSetting<string[]>("security.deniedPaths", []),
    });
  }

  buildLocal(input: { path: string }) {
    return this.#buildEngine.build(input.path, {
      allowedPaths: this.state.getSetting<string[]>("security.allowedPaths", []),
      deniedPaths: this.state.getSetting<string[]>("security.deniedPaths", []),
    });
  }

  settingsGet() {
    return { language: this.state.getSetting<"zh-CN" | "en">("language", "zh-CN") };
  }

  settingsSave(input: { language: "zh-CN" | "en" }) {
    this.state.saveSetting("language", input.language);
    return this.settingsGet();
  }
}
