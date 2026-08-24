import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ResourceKind } from "./domain";
import { AppError } from "./errors";
import { PolicyEngine } from "./policy/policy-engine";
import type { SyncProgressHandler } from "./sync/sync-engine";
import { SyncEngine } from "./sync/sync-engine";
import { inspectLocalProject } from "./deployment/local-analyzer";
import { BuildEngine } from "./deployment/build-engine";
import { PagesDeployEngine, type PagesDeployResult } from "./deployment/pages-deploy-engine";
import type { CredentialStore } from "../credentials/credential-store";
import { CloudflareClient } from "../providers/cloudflare/client/cloudflare-client";
import type { ResourceRegistry } from "../providers/cloudflare/registry";
import type { StateStore } from "../state/state-store";

export class AgentCore {
  readonly #syncEngine: SyncEngine;
  readonly #buildEngine: BuildEngine;
  readonly #pagesDeployEngine: PagesDeployEngine;

  constructor(
    private readonly state: StateStore,
    private readonly credentials: CredentialStore,
    registry: ResourceRegistry,
    private readonly policy = new PolicyEngine(),
    buildEngine = new BuildEngine(),
    pagesDeployEngine = new PagesDeployEngine(),
  ) {
    this.#syncEngine = new SyncEngine(state, credentials, registry);
    this.#buildEngine = buildEngine;
    this.#pagesDeployEngine = pagesDeployEngine;
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
    let selected: { id: string; name: string } | undefined;
    try {
      const accounts = await client.listAccounts();
      selected = accounts.find((account) => account.id === input.remoteAccountId);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "AUTH_FORBIDDEN") throw error;
    }
    if (!selected) await client.verifyPagesAccountAccess(input.remoteAccountId);
    await this.credentials.saveToken(input.remoteAccountId, input.token);
    return this.state.saveAccount({ remoteAccountId: input.remoteAccountId, name: selected?.name || input.name, activate: true });
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

  async deployPages(input: { path: string; projectName: string }): Promise<PagesDeployResult> {
    const account = this.state.getActiveAccount();
    if (!account) throw new AppError("ACCOUNT_NOT_CONFIGURED", "Connect a Cloudflare account first");
    const token = await this.credentials.getToken(account.remoteAccountId);
    if (!token) throw new AppError("ACCOUNT_NOT_CONFIGURED", "Cloudflare credential is unavailable");

    const inspected = inspectLocalProject(input.path, {
      allowedPaths: this.state.getSetting<string[]>("security.allowedPaths", []),
      deniedPaths: this.state.getSetting<string[]>("security.deniedPaths", []),
    });
    if (!inspected.supported) throw new AppError("UNSUPPORTED_FRAMEWORK", inspected.reason);
    const outputDirectory = path.resolve(inspected.project.path, inspected.project.output_directory);
    const client = new CloudflareClient(token);
    const projectPath = `/accounts/${account.remoteAccountId}/pages/projects/${encodeURIComponent(input.projectName)}`;
    const correlationId = `deploy_${randomUUID()}`;

    try {
      let project: PagesProject | null = null;
      try {
        project = (await client.get<PagesProject>(projectPath)).result;
      } catch (error) {
        if (!(error instanceof AppError) || error.details?.status !== 404) throw error;
      }

      const localResource = this.state.listResources({ accountId: account.id, kind: "pages_project" })
        .find((resource) => resource.remoteId === input.projectName);
      if (project && (isGitBackedPages(project.source) || localResource?.ownership !== "managed")) {
        throw new AppError("PAGES_PROJECT_CONFLICT", "An existing Pages project with this name is not managed by this app");
      }
      if (!project) {
        project = (await client.post<PagesProject>(`/accounts/${account.remoteAccountId}/pages/projects`, {
          name: input.projectName,
          production_branch: "main",
        })).result;
        const [created] = this.state.upsertResources(account.id, "pages_project", [{
          remoteId: input.projectName,
          name: input.projectName,
          remoteStatus: "deploying",
          remoteUpdatedAt: new Date().toISOString(),
          metadata: {
            subdomain: project.subdomain,
            production_branch: project.production_branch ?? "main",
          },
        }], new Date().toISOString());
        if (!created) throw new AppError("INTERNAL_ERROR", "Could not cache the new Pages project", false);
        this.state.adoptResource(created.id);
      }

      const productionUrl = normalizePagesUrl(project.subdomain, input.projectName);
      const result = await this.#pagesDeployEngine.deploy({
        outputDirectory,
        projectName: input.projectName,
        accountId: account.remoteAccountId,
        token,
        productionUrl,
      });
      this.state.addActivity({
        accountId: account.id,
        initiator: "gui",
        action: "pages.deploy",
        target: input.projectName,
        result: "succeeded",
        correlationId,
        summary: `Deployed ${input.projectName} to Cloudflare Pages`,
      });
      return result;
    } catch (error) {
      this.state.addActivity({
        accountId: account.id,
        initiator: "gui",
        action: "pages.deploy",
        target: input.projectName,
        result: "failed",
        correlationId,
        summary: `Cloudflare Pages deployment failed for ${input.projectName}`,
      });
      throw error;
    }
  }

  settingsGet() {
    return { language: this.state.getSetting<"zh-CN" | "en">("language", "zh-CN") };
  }

  settingsSave(input: { language: "zh-CN" | "en" }) {
    this.state.saveSetting("language", input.language);
    return this.settingsGet();
  }
}

interface PagesProject {
  name?: string;
  subdomain?: string;
  production_branch?: string;
  source?: unknown;
}

export function isGitBackedPages(source: unknown): boolean {
  if (!source || typeof source !== "object") return false;
  const value = source as { type?: unknown; config?: { repo_name?: unknown } };
  return value.type === "github" || value.type === "gitlab"
    || (typeof value.config?.repo_name === "string" && value.config.repo_name.length > 0);
}

function normalizePagesUrl(subdomain: string | undefined, projectName: string): string {
  const value = subdomain?.trim() || `${projectName}.pages.dev`;
  return /^https:\/\//i.test(value) ? value : `https://${value}`;
}
