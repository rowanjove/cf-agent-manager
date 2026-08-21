import "./style.css";
import brandIconUrl from "./assets/app-icon.png";

import type { AccountRecord, ActivityRecord, ProjectRecord, ResourceKind, ResourceRecord, SyncResult } from "../core/domain";
import type { InspectResult } from "../core/deployment/local-analyzer";
import type { BuildResult } from "../core/deployment/build-engine";
import { translate, type Language, type TranslationKey } from "./i18n";

type View = "overview" | "resources" | "projects" | "deploy" | "activity" | "settings";

const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "overview";
let language: Language = "zh-CN";
let accounts: AccountRecord[] = [];
let resources: ResourceRecord[] = [];
let projects: ProjectRecord[] = [];
let activity: ActivityRecord[] = [];
let lastSync: SyncResult | null = null;
let busy = false;
let notice: { kind: "error" | "success"; text: string } | null = null;
let kindFilter: ResourceKind | "all" = "all";
let selectedLocalPath: string | null = null;
let inspectResult: InspectResult | null = null;
let buildResult: BuildResult | null = null;

const labels: Record<string, string> = {
  pages_project: "Pages", worker: "Workers", d1_database: "D1", kv_namespace: "KV",
  r2_bucket: "R2", zone: "Zones", dns_record: "DNS", queue: "Queues",
};

const navIcons: Record<View, string> = {
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
  projects: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h7l2 2h9v10.5H3z"/></svg>',
  resources: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v4H5zM5 11h14v4H5zM5 17h14v2H5z"/></svg>',
  deploy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l5 5h-3v7h-4V8H7zM5 17h14v4H5z"/></svg>',
  activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v2H4zM4 11h16v2H4zM4 17h10v2H4z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.5 5.5v-3l-2.2-.7-.5-1.2 1.1-2-2.1-2.1-2 1.1-1.3-.5-.7-2.1h-3l-.7 2.1-1.3.5-2-1.1-2.1 2.1 1.1 2-.5 1.2-2.2.7v3l2.2.7.5 1.2-1.1 2 2.1 2.1 2-1.1 1.3.5.7 2.1h3l.7-2.1 1.3-.5 2 1.1 2.1-2.1-1.1-2 .5-1.2z"/></svg>',
};

const t = (key: TranslationKey, variables?: Record<string, string | number>): string => translate(language, key, variables ?? {});

async function loadCache(): Promise<void> {
  const [settings, accountRows, resourceRows, projectRows, activityRows, syncResult] = await Promise.all([
    window.cfAgent.settings.get(), window.cfAgent.accounts.list(), window.cfAgent.resources.list(),
    window.cfAgent.projects.list(), window.cfAgent.activity.list(50), window.cfAgent.accounts.syncStatus(),
  ]);
  language = settings.language;
  document.documentElement.lang = language;
  accounts = accountRows;
  resources = resourceRows;
  projects = projectRows;
  activity = activityRows;
  lastSync = syncResult;
}

function activeAccount(): AccountRecord | undefined { return accounts.find((account) => account.isActive); }

function render(): void {
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand"><img class="brand-mark" src="${brandIconUrl}" alt="" /><div><strong>CF Agent Manager</strong><span>${t("brand.subtitle")}</span></div></div>
      <nav>
        ${navButton("overview", t("nav.overview"))}
        ${navButton("projects", t("nav.projects"))}
        <p class="nav-label">${t("nav.cloudflare")}</p>
        ${navButton("resources", t("nav.resources"))}
        ${navButton("deploy", t("nav.deploy"))}
        ${navButton("activity", t("nav.activity"))}
        <p class="nav-label">${t("nav.system")}</p>
        ${navButton("settings", t("nav.settings"))}
      </nav>
      <div class="account-chip"><span class="status-dot ${activeAccount() ? "online" : ""}"></span><div><small>${t("account.active")}</small><strong>${escapeHtml(activeAccount()?.name ?? t("account.none"))}</strong></div></div>
    </aside>
    <main>
      <header class="topbar"><h1>${titleFor(view)}</h1>
        <div class="top-actions"><span class="sync-copy">${escapeHtml(syncLabel())}</span><button class="button ghost" data-action="sync" ${busy || !activeAccount() ? "disabled" : ""}><span class="button-icon">↻</span>${busy ? t("sync.running") : t("sync.now")}</button></div>
      </header>
      ${notice ? `<div class="notice ${notice.kind}">${escapeHtml(notice.text)}</div>` : ""}
      <section class="content">${renderView()}</section>
    </main>`;
  bindEvents();
}

function navButton(target: View, label: string): string {
  return `<button class="nav-item ${view === target ? "active" : ""}" data-view="${target}"><span class="nav-icon">${navIcons[target]}</span>${escapeHtml(label)}</button>`;
}

function titleFor(target: View): string {
  return t(({
    overview: "title.overview", resources: "title.resources", projects: "title.projects",
    deploy: "title.deploy", activity: "title.activity", settings: "title.settings",
  } satisfies Record<View, TranslationKey>)[target]);
}

function syncLabel(): string {
  const value = activeAccount()?.lastSyncedAt;
  return value ? t("sync.last", { time: formatDate(value) }) : activeAccount() ? t("sync.never") : t("sync.offline");
}

function renderView(): string {
  if (view === "overview") return renderOverview();
  if (view === "resources") return renderResources();
  if (view === "projects") return renderProjects();
  if (view === "deploy") return renderDeploy();
  if (view === "activity") return renderActivity();
  return renderSettings();
}

function renderOverview(): string {
  const countMap = new Map<ResourceKind, number>();
  for (const resource of resources.filter((item) => item.syncState !== "remote_missing")) {
    countMap.set(resource.kind, (countMap.get(resource.kind) ?? 0) + 1);
  }
  const services = lastSync?.adapters.map((adapter) => ({ kind: adapter.kind, count: adapter.count ?? countMap.get(adapter.kind) ?? 0, success: adapter.success, errorCode: adapter.errorCode }))
    ?? [...countMap.entries()].map(([kind, count]) => ({ kind, count, success: true, errorCode: undefined }));
  const external = resources.filter((resource) => resource.ownership === "external").length;
  const issues = resources.filter((resource) => resource.syncState === "remote_missing" || resource.syncState === "error").length;
  return `
    <div class="overview-intro"><div><p class="section-label">${t("overview.badge")}</p><h2>${activeAccount() ? t("overview.connected", { account: activeAccount()!.name ?? activeAccount()!.remoteAccountId }) : t("overview.disconnected")}</h2><p>${t("overview.subtitle")}</p></div><span class="connection-state ${activeAccount() ? "connected" : ""}"><i></i>${activeAccount() ? t("account.connected") : t("account.none")}</span></div>
    <div class="metric-grid">
      ${metric(t("metric.resources"), String(resources.length), t("metric.resourcesHint"))}
      ${metric(t("metric.external"), String(external), t("metric.externalHint"))}
      ${metric(t("metric.projects"), String(projects.length), t("metric.projectsHint"))}
      ${metric(t("metric.attention"), String(issues), issues ? t("metric.attentionHint") : t("metric.healthy"))}
    </div>
    <div class="split-grid">
      <article class="panel"><div class="panel-title"><div><p class="eyebrow">${t("section.inventory")}</p><h3>${t("section.services")}</h3></div><button class="text-button" data-view="resources">${t("action.viewAll")}</button></div>
        <div class="service-list">${services.length ? services.map((service) => `<button data-kind="${service.kind}" class="${service.success ? "" : "unavailable"}"><span class="service-icon">${escapeHtml(labels[service.kind]?.slice(0, 2) ?? "CF")}</span><strong>${escapeHtml(labels[service.kind] ?? service.kind)}${service.success ? "" : `<small>${escapeHtml(service.errorCode ?? "unavailable")}</small>`}</strong><em>${service.success ? service.count : "!"}</em></button>`).join("") : empty(t("empty.resources"), t("empty.resourcesHint"))}</div>
      </article>
      <article class="panel"><div class="panel-title"><div><p class="eyebrow">${t("section.recent")}</p><h3>${t("section.activity")}</h3></div><button class="text-button" data-view="activity">${t("action.audit")}</button></div>${activityRows(activity.slice(0, 6))}</article>
    </div>`;
}

function metric(label: string, value: string, caption: string): string {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`;
}

function renderResources(): string {
  const syncedKinds = lastSync?.adapters.map((adapter) => adapter.kind) ?? [];
  const kinds = [...new Set([...syncedKinds, ...resources.map((resource) => resource.kind)])];
  const filtered = resources.filter((resource) => kindFilter === "all" || resource.kind === kindFilter);
  return `<div class="toolbar"><div class="segmented"><button data-kind="all" class="${kindFilter === "all" ? "selected" : ""}">${t("filter.all")} <b>${resources.length}</b></button>${kinds.map((kind) => `<button data-kind="${kind}" class="${kindFilter === kind ? "selected" : ""}">${escapeHtml(labels[kind] ?? kind)} <b>${resources.filter((resource) => resource.kind === kind).length}</b></button>`).join("")}</div></div>
    <article class="panel table-panel">${filtered.length ? `<table><thead><tr><th>${t("table.name")}</th><th>${t("table.service")}</th><th>${t("table.status")}</th><th>${t("table.ownership")}</th><th>${t("table.updated")}</th><th></th></tr></thead><tbody>${filtered.map(resourceRow).join("")}</tbody></table>` : empty(t("empty.match"), activeAccount() ? t("empty.permission") : t("empty.connect"))}</article>`;
}

function resourceRow(resource: ResourceRecord): string {
  const status = resource.syncState === "fresh" ? resource.remoteStatus ?? t("status.available") : resource.syncState === "remote_missing" ? t("status.remoteMissing") : resource.syncState;
  const ownership = resource.ownership === "managed" ? t("ownership.managed") : t("ownership.external");
  return `<tr><td><strong>${escapeHtml(resource.name)}</strong><small>${escapeHtml(resource.remoteId)}</small></td><td>${escapeHtml(labels[resource.kind] ?? resource.kind)}</td><td><span class="state ${resource.syncState}">${escapeHtml(status)}</span></td><td><span class="ownership ${resource.ownership}">${ownership}</span></td><td>${escapeHtml(formatDate(resource.remoteUpdatedAt ?? resource.lastSyncedAt))}</td><td>${resource.ownership === "external" ? `<button class="button tiny" data-adopt="${resource.id}">${t("action.adopt")}</button>` : ""}</td></tr>`;
}

function renderProjects(): string {
  return `<div class="section-heading"><div><p class="eyebrow">${t("projects.badge")}</p><h2>${t("projects.heading")}</h2></div><button class="button primary" data-action="new-project">${t("projects.new")}</button></div>
    <div class="project-grid">${projects.length ? projects.map((project) => `<article class="project-card"><div class="project-glyph">◇</div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.description ?? t("projects.noDescription"))}</p><div><span>${project.tags.length ? project.tags.map((tag) => `#${escapeHtml(tag)}`).join(" ") : t("projects.noTags")}</span><small>${formatDate(project.updatedAt)}</small></div></article>`).join("") : empty(t("projects.empty"), t("projects.emptyHint"))}</div>`;
}

function renderActivity(): string {
  return `<article class="panel"><div class="panel-title"><div><p class="eyebrow">${t("activity.badge")}</p><h3>${t("activity.heading")}</h3></div></div>${activityRows(activity)}</article>`;
}

function renderDeploy(): string {
  const actionLabel = selectedLocalPath ? t("deploy.change") : t("deploy.choose");
  const result = inspectResult?.supported
    ? `<article class="panel inspect-result"><div class="inspect-status supported"><span>✓</span><div><strong>${t("deploy.supported")}</strong><small>${escapeHtml(inspectResult.project.path)}</small></div></div><dl><dt>${t("deploy.framework")}</dt><dd>${escapeHtml(inspectResult.project.framework)}</dd><dt>${t("deploy.packageManager")}</dt><dd>${escapeHtml(inspectResult.project.package_manager ?? t("deploy.none"))}</dd><dt>${t("deploy.installCommand")}</dt><dd><code>${escapeHtml(inspectResult.project.install_command ?? t("deploy.none"))}</code></dd><dt>${t("deploy.buildCommand")}</dt><dd><code>${escapeHtml(inspectResult.project.build_command ?? t("deploy.none"))}</code></dd><dt>${t("deploy.output")}</dt><dd><code>${escapeHtml(inspectResult.project.output_directory)}</code></dd></dl>${buildResult ? `<div class="build-ready"><span>✓</span><div><strong>${t("deploy.buildReady")}</strong><code>${escapeHtml(buildResult.output_directory)}</code></div></div>` : `<div class="next-gate"><div><strong>${t("deploy.buildTitle")}</strong><p>${t("deploy.buildHint")}</p></div><button class="button primary" data-action="build-project" ${busy ? "disabled" : ""}>${busy ? t("deploy.building") : t("deploy.buildAction")}</button></div>`}</article>`
    : inspectResult ? `<article class="panel inspect-result"><div class="inspect-status unsupported"><span>!</span><div><strong>${t("deploy.unsupported")}</strong><small>${escapeHtml(inspectResult.reason)}</small></div></div></article>` : empty(t("deploy.noSelection"), t("deploy.noSelectionHint"));
  return `<div class="section-heading"><div><p class="eyebrow">${t("deploy.badge")}</p><h2>${t("deploy.heading")}</h2><p class="muted">${t("deploy.description")}</p></div><button class="button primary" data-action="choose-deploy-folder">${actionLabel}</button></div>${selectedLocalPath ? `<div class="selected-path"><span>${t("deploy.path")}</span><code>${escapeHtml(selectedLocalPath)}</code></div>` : ""}${result}`;
}

function activityRows(rows: ActivityRecord[]): string {
  if (!rows.length) return empty(t("activity.empty"), t("activity.emptyHint"));
  return `<div class="activity-list">${rows.map((item) => `<div><span class="activity-mark ${item.result}"></span><section><strong>${escapeHtml(activitySummary(item))}</strong><small>${escapeHtml(item.initiator.toUpperCase())} · ${escapeHtml(item.correlationId)}</small></section><time>${escapeHtml(formatDate(item.createdAt))}</time></div>`).join("")}</div>`;
}

function activitySummary(item: ActivityRecord): string {
  if (item.action === "account.sync") return t(item.result === "partial" ? "activity.syncPartial" : "activity.syncSuccess");
  if (item.action === "project.create") return t("activity.projectCreated", { target: item.target ?? "" });
  if (item.action === "resource.adopt") return t("activity.resourceAdopted", { target: item.target ?? "" });
  return item.summary;
}

function renderSettings(): string {
  return `<div class="settings-grid">
    <article class="panel"><p class="eyebrow">${t("settings.account")}</p><h3>${activeAccount() ? escapeHtml(activeAccount()!.name ?? activeAccount()!.remoteAccountId) : t("settings.connect")}</h3><p class="muted">${t("settings.tokenHint")}</p>
      ${activeAccount() ? `<dl><dt>${t("settings.accountId")}</dt><dd>${escapeHtml(activeAccount()!.remoteAccountId)}</dd><dt>${t("settings.credential")}</dt><dd>${t("settings.credentialStored")}</dd></dl>` : `<form id="connect-form"><label>${t("settings.token")}<input name="token" type="password" autocomplete="off" minlength="20" required placeholder="${t("settings.tokenPlaceholder")}" /></label><button class="button primary" type="submit">${t("settings.discover")}</button></form><div id="account-picker"></div>`}
    </article>
    <article class="panel"><p class="eyebrow">${t("settings.language")}</p><h3>${language === "zh-CN" ? t("language.zh") : t("language.en")}</h3><p class="muted">${t("settings.languageHint")}</p><label class="language-picker"><select id="language-select"><option value="zh-CN" ${language === "zh-CN" ? "selected" : ""}>${t("language.zh")}</option><option value="en" ${language === "en" ? "selected" : ""}>${t("language.en")}</option></select></label></article>
    <article class="panel safety-panel"><p class="eyebrow">${t("settings.safety")}</p><h3>${t("settings.safetyHeading")}</h3><ul class="safety-list"><li><span>${t("settings.read")}</span><strong>${t("settings.allowed")}</strong></li><li><span>${t("settings.externalEdit")}</span><strong>${t("settings.confirm")}</strong></li><li><span>${t("settings.dnsSecrets")}</span><strong>${t("settings.confirm")}</strong></li><li><span>${t("settings.destructive")}</span><strong>${t("settings.confirmDeny")}</strong></li></ul></article>
  </div>`;
}

function empty(title: string, detail: string): string { return `<div class="empty"><span>◌</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`; }

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => button.addEventListener("click", () => { view = button.dataset.view as View; render(); }));
  document.querySelectorAll<HTMLElement>("[data-kind]").forEach((button) => button.addEventListener("click", () => { kindFilter = button.dataset.kind as ResourceKind | "all"; view = "resources"; render(); }));
  document.querySelector<HTMLElement>("[data-action='sync']")?.addEventListener("click", () => void runSync());
  document.querySelector<HTMLElement>("[data-action='new-project']")?.addEventListener("click", () => void newProject());
  document.querySelector<HTMLElement>("[data-action='choose-deploy-folder']")?.addEventListener("click", () => void chooseDeployFolder());
  document.querySelector<HTMLElement>("[data-action='build-project']")?.addEventListener("click", () => void buildProject());
  document.querySelectorAll<HTMLElement>("[data-adopt]").forEach((button) => button.addEventListener("click", () => void adopt(button.dataset.adopt!)));
  document.querySelector<HTMLFormElement>("#connect-form")?.addEventListener("submit", (event) => { event.preventDefault(); void discoverAccounts(event.currentTarget as HTMLFormElement); });
  document.querySelector<HTMLSelectElement>("#language-select")?.addEventListener("change", (event) => void changeLanguage((event.currentTarget as HTMLSelectElement).value as Language));
}

async function changeLanguage(nextLanguage: Language): Promise<void> {
  const saved = await window.cfAgent.settings.save({ language: nextLanguage });
  language = saved.language;
  document.documentElement.lang = language;
  notice = null;
  render();
}

async function chooseDeployFolder(): Promise<void> {
  const selected = await window.cfAgent.app.pickDirectory();
  if (!selected) return;
  selectedLocalPath = selected;
  inspectResult = null;
  buildResult = null;
  busy = true;
  notice = null;
  render();
  try { inspectResult = await window.cfAgent.deploy.inspect(selected); }
  catch (error) { notice = { kind: "error", text: messageOf(error) }; }
  finally { busy = false; render(); }
}

async function buildProject(): Promise<void> {
  if (!selectedLocalPath) return;
  busy = true; notice = null; render();
  try {
    const result = await window.cfAgent.deploy.build(selectedLocalPath);
    if (result) {
      buildResult = result;
      notice = { kind: "success", text: t("deploy.buildSuccess") };
    }
  } catch (error) { notice = { kind: "error", text: messageOf(error) }; }
  finally { busy = false; render(); }
}

async function runSync(): Promise<void> {
  busy = true; notice = null; render();
  try {
    const result = await window.cfAgent.accounts.sync();
    await loadCache();
    notice = { kind: result.partial ? "error" : "success", text: result.partial ? t("notice.syncPartial") : t("notice.syncSuccess") };
  } catch (error) { notice = { kind: "error", text: messageOf(error) }; }
  finally { busy = false; render(); }
}

async function discoverAccounts(form: HTMLFormElement): Promise<void> {
  const tokenInput = new FormData(form).get("token");
  if (typeof tokenInput !== "string") return;
  busy = true; notice = null; render();
  try {
    const remote = await window.cfAgent.accounts.discover(tokenInput);
    const picker = document.querySelector<HTMLDivElement>("#account-picker");
    if (!picker) return;
    picker.innerHTML = remote.length ? `<div class="account-options"><p>${t("settings.selectAccount")}</p>${remote.map((account) => `<button class="button account-option" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.name)}">${escapeHtml(account.name)}<small>${escapeHtml(account.id)}</small></button>`).join("")}</div>` : `<p class="muted">${t("settings.noAccounts")}</p>`;
    picker.querySelectorAll<HTMLButtonElement>("[data-account-id]").forEach((button) => button.addEventListener("click", () => void connectAccount(tokenInput, button.dataset.accountId!, button.dataset.accountName!)));
  } catch (error) { notice = { kind: "error", text: messageOf(error) }; render(); }
  finally { busy = false; }
}

async function connectAccount(token: string, remoteAccountId: string, name: string): Promise<void> {
  busy = true;
  try {
    await window.cfAgent.accounts.connect({ token, remoteAccountId, name });
    await loadCache(); view = "overview"; notice = { kind: "success", text: t("notice.connected") }; render();
    await runSync();
  } catch (error) { notice = { kind: "error", text: messageOf(error) }; render(); }
  finally { busy = false; }
}

async function adopt(resourceId: string): Promise<void> {
  if (!window.confirm(t("dialog.adopt"))) return;
  try {
    const authorization = await window.cfAgent.resources.adoptConfirmation(resourceId);
    await window.cfAgent.resources.adopt(resourceId, authorization);
    await loadCache(); notice = { kind: "success", text: t("notice.adopted") }; render();
  } catch (error) { notice = { kind: "error", text: messageOf(error) }; render(); }
}

async function newProject(): Promise<void> {
  const name = window.prompt(t("dialog.projectName"));
  if (!name?.trim()) return;
  const description = window.prompt(t("dialog.projectDescription")) || null;
  try { await window.cfAgent.projects.create({ name: name.trim(), description }); await loadCache(); render(); }
  catch (error) { notice = { kind: "error", text: messageOf(error) }; render(); }
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : t("error.unexpected"); }
function formatDate(value: string): string { return new Date(value).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" }); }
function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

void (async () => {
  try { await loadCache(); }
  catch (error) { notice = { kind: "error", text: messageOf(error) }; }
  render();
})();
