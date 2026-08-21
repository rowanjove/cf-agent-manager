import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AccountRecord,
  ActivityRecord,
  NormalizedResource,
  ProjectRecord,
  ProjectResourceLinkRecord,
  ResourceKind,
  ResourceRecord,
  SyncResult,
} from "../core/domain";

type Row = Record<string, unknown>;

export class StateStore {
  readonly #db: DatabaseSync;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#migrate();
  }

  close(): void {
    this.#db.close();
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider = 'cloudflare'),
        remote_account_id TEXT NOT NULL UNIQUE,
        name TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL,
        description TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        role TEXT NOT NULL,
        framework TEXT,
        build_config_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(project_id, path)
      );
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL,
        remote_id TEXT NOT NULL,
        name TEXT NOT NULL,
        ownership TEXT NOT NULL CHECK(ownership IN ('managed','external')),
        remote_status TEXT,
        remote_updated_at TEXT,
        last_synced_at TEXT NOT NULL,
        sync_state TEXT NOT NULL CHECK(sync_state IN ('fresh','stale','remote_missing','error')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        metadata_schema_version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(account_id, kind, remote_id)
      );
      CREATE TABLE IF NOT EXISTS project_resources (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        role TEXT,
        linked_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, resource_id)
      );
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        resource_id TEXT NOT NULL REFERENCES resources(id),
        local_source_id TEXT REFERENCES local_sources(id),
        provider TEXT NOT NULL CHECK(provider = 'cloudflare'),
        kind TEXT NOT NULL CHECK(kind IN ('pages','worker')),
        status TEXT NOT NULL CHECK(status IN ('running','succeeded','partial','failed','cancelled')),
        remote_deployment_id TEXT,
        production_url TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        correlation_id TEXT NOT NULL UNIQUE,
        error_code TEXT
      );
      CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id),
        hostname TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(resource_id, hostname)
      );
      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        partial INTEGER NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES accounts(id),
        initiator TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        result TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_policies (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id),
        policy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resources_account_kind ON resources(account_id, kind);
      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
    `);
  }

  saveAccount(input: { remoteAccountId: string; name: string | null; activate?: boolean }): AccountRecord {
    const existing = this.#db.prepare("SELECT id FROM accounts WHERE remote_account_id = ?").get(input.remoteAccountId) as Row | undefined;
    const id = String(existing?.id ?? randomUUID());
    if (input.activate) this.#db.exec("UPDATE accounts SET is_active = 0");
    this.#db.prepare(`
      INSERT INTO accounts(id, provider, remote_account_id, name, is_active)
      VALUES (?, 'cloudflare', ?, ?, ?)
      ON CONFLICT(remote_account_id) DO UPDATE SET
        name = excluded.name,
        is_active = CASE WHEN excluded.is_active = 1 THEN 1 ELSE accounts.is_active END
    `).run(id, input.remoteAccountId, input.name, input.activate ? 1 : 0);
    return this.getAccount(id)!;
  }

  setActiveAccount(id: string): AccountRecord | null {
    if (!this.getAccount(id)) return null;
    this.#db.exec("UPDATE accounts SET is_active = 0");
    this.#db.prepare("UPDATE accounts SET is_active = 1 WHERE id = ?").run(id);
    return this.getAccount(id);
  }

  getActiveAccount(): AccountRecord | null {
    const row = this.#db.prepare("SELECT * FROM accounts WHERE is_active = 1 LIMIT 1").get() as Row | undefined;
    return row ? mapAccount(row) : null;
  }

  getAccount(id: string): AccountRecord | null {
    const row = this.#db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Row | undefined;
    return row ? mapAccount(row) : null;
  }

  listAccounts(): AccountRecord[] {
    return (this.#db.prepare("SELECT * FROM accounts ORDER BY is_active DESC, name").all() as Row[]).map(mapAccount);
  }

  upsertResources(accountId: string, kind: ResourceKind, items: NormalizedResource[], syncedAt: string): ResourceRecord[] {
    const statement = this.#db.prepare(`
      INSERT INTO resources(
        id, account_id, kind, remote_id, name, ownership, remote_status,
        remote_updated_at, last_synced_at, sync_state, metadata_json, metadata_schema_version
      ) VALUES (?, ?, ?, ?, ?, 'external', ?, ?, ?, 'fresh', ?, 1)
      ON CONFLICT(account_id, kind, remote_id) DO UPDATE SET
        name = excluded.name,
        remote_status = excluded.remote_status,
        remote_updated_at = excluded.remote_updated_at,
        last_synced_at = excluded.last_synced_at,
        sync_state = 'fresh',
        metadata_json = excluded.metadata_json,
        metadata_schema_version = excluded.metadata_schema_version
    `);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items) {
        statement.run(
          randomUUID(), accountId, kind, item.remoteId, item.name, item.remoteStatus,
          item.remoteUpdatedAt, syncedAt, JSON.stringify(item.metadata),
        );
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.listResources({ accountId, kind });
  }

  markMissing(accountId: string, kind: ResourceKind, seenRemoteIds: readonly string[]): void {
    if (seenRemoteIds.length === 0) {
      this.#db.prepare("UPDATE resources SET sync_state = 'remote_missing' WHERE account_id = ? AND kind = ?").run(accountId, kind);
      return;
    }
    const placeholders = seenRemoteIds.map(() => "?").join(",");
    this.#db.prepare(`
      UPDATE resources SET sync_state = 'remote_missing'
      WHERE account_id = ? AND kind = ? AND remote_id NOT IN (${placeholders})
    `).run(accountId, kind, ...seenRemoteIds);
  }

  listResources(filter: { accountId?: string | undefined; kind?: ResourceKind | undefined; ownership?: "managed" | "external" | undefined } = {}): ResourceRecord[] {
    const where: string[] = [];
    const values: string[] = [];
    if (filter.accountId) { where.push("account_id = ?"); values.push(filter.accountId); }
    if (filter.kind) { where.push("kind = ?"); values.push(filter.kind); }
    if (filter.ownership) { where.push("ownership = ?"); values.push(filter.ownership); }
    const sql = `SELECT * FROM resources${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY kind, name`;
    return (this.#db.prepare(sql).all(...values) as Row[]).map(mapResource);
  }

  getResource(id: string): ResourceRecord | null {
    const row = this.#db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as Row | undefined;
    return row ? mapResource(row) : null;
  }

  adoptResource(id: string): ResourceRecord | null {
    this.#db.prepare("UPDATE resources SET ownership = 'managed' WHERE id = ?").run(id);
    return this.getResource(id);
  }

  createProject(input: { accountId: string; name: string; description?: string | null | undefined; tags?: string[] | undefined }): ProjectRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.#db.prepare(`
      INSERT INTO projects(id, account_id, name, description, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.accountId, input.name, input.description ?? null, JSON.stringify(input.tags ?? []), now, now);
    return this.getProject(id)!;
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.#db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
    return row ? mapProject(row) : null;
  }

  listProjects(accountId?: string): ProjectRecord[] {
    const rows = accountId
      ? this.#db.prepare("SELECT * FROM projects WHERE account_id = ? ORDER BY name").all(accountId)
      : this.#db.prepare("SELECT * FROM projects ORDER BY name").all();
    return (rows as Row[]).map(mapProject);
  }

  linkResource(input: { projectId: string; resourceId: string; role?: string | null | undefined; linkedBy?: ProjectResourceLinkRecord["linkedBy"] | undefined }): void {
    this.#db.prepare(`
      INSERT INTO project_resources(project_id, resource_id, role, linked_by, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, resource_id) DO UPDATE SET role = excluded.role, linked_by = excluded.linked_by
    `).run(input.projectId, input.resourceId, input.role ?? null, input.linkedBy ?? "user", new Date().toISOString());
  }

  unlinkResource(projectId: string, resourceId: string): void {
    this.#db.prepare("DELETE FROM project_resources WHERE project_id = ? AND resource_id = ?").run(projectId, resourceId);
  }

  listProjectResourceIds(projectId: string): string[] {
    return (this.#db.prepare("SELECT resource_id FROM project_resources WHERE project_id = ?").all(projectId) as Row[])
      .map((row) => String(row.resource_id));
  }

  recordSync(result: SyncResult): void {
    this.#db.prepare(`
      INSERT INTO sync_runs(id, account_id, started_at, finished_at, partial, result_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), result.accountId, result.startedAt, result.finishedAt, result.partial ? 1 : 0, JSON.stringify(result));
    this.#db.prepare("UPDATE accounts SET last_synced_at = ? WHERE id = ?").run(result.finishedAt, result.accountId);
  }

  getLatestSync(accountId: string): SyncResult | null {
    const row = this.#db.prepare("SELECT result_json FROM sync_runs WHERE account_id = ? ORDER BY finished_at DESC LIMIT 1").get(accountId) as Row | undefined;
    return row ? JSON.parse(String(row.result_json)) as SyncResult : null;
  }

  addActivity(input: Omit<ActivityRecord, "id" | "createdAt">): ActivityRecord {
    const record: ActivityRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#db.prepare(`
      INSERT INTO activity_log(id, account_id, initiator, action, target, result, correlation_id, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.accountId, record.initiator, record.action, record.target, record.result, record.correlationId, record.summary, record.createdAt);
    return record;
  }

  listActivity(limit = 100): ActivityRecord[] {
    return (this.#db.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(mapActivity);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.#db.prepare("SELECT value_json FROM settings_meta WHERE key = ?").get(key) as Row | undefined;
    return row ? JSON.parse(String(row.value_json)) as T : fallback;
  }

  saveSetting(key: string, value: unknown): void {
    this.#db.prepare(`
      INSERT INTO settings_meta(key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), new Date().toISOString());
  }
}

function mapAccount(row: Row): AccountRecord {
  return {
    id: String(row.id), provider: "cloudflare", remoteAccountId: String(row.remote_account_id),
    name: row.name === null ? null : String(row.name), isActive: Boolean(row.is_active),
    lastSyncedAt: row.last_synced_at === null ? null : String(row.last_synced_at),
  };
}

function mapResource(row: Row): ResourceRecord {
  return {
    id: String(row.id), accountId: String(row.account_id), kind: row.kind as ResourceKind,
    remoteId: String(row.remote_id), name: String(row.name), ownership: row.ownership as ResourceRecord["ownership"],
    remoteStatus: row.remote_status === null ? null : String(row.remote_status),
    remoteUpdatedAt: row.remote_updated_at === null ? null : String(row.remote_updated_at),
    lastSyncedAt: String(row.last_synced_at), syncState: row.sync_state as ResourceRecord["syncState"],
    metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
    metadataSchemaVersion: Number(row.metadata_schema_version),
  };
}

function mapProject(row: Row): ProjectRecord {
  return {
    id: String(row.id), accountId: String(row.account_id), name: String(row.name),
    description: row.description === null ? null : String(row.description),
    tags: JSON.parse(String(row.tags_json)) as string[], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapActivity(row: Row): ActivityRecord {
  return {
    id: String(row.id), accountId: row.account_id === null ? null : String(row.account_id),
    initiator: row.initiator as ActivityRecord["initiator"], action: String(row.action),
    target: row.target === null ? null : String(row.target), result: row.result as ActivityRecord["result"],
    correlationId: String(row.correlation_id), summary: String(row.summary), createdAt: String(row.created_at),
  };
}
