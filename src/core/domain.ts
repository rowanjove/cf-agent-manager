export const RESOURCE_KINDS = [
  "pages_project",
  "worker",
  "d1_database",
  "kv_namespace",
  "r2_bucket",
  "zone",
  "dns_record",
  "queue",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ResourceOwnership = "managed" | "external";
export type SyncState = "fresh" | "stale" | "remote_missing" | "error";
export type ResourceCapability =
  | "discover"
  | "inspect"
  | "create"
  | "update"
  | "delete"
  | "deploy"
  | "logs"
  | "bindings"
  | "secrets"
  | "objects";

export interface AccountRecord {
  id: string;
  provider: "cloudflare";
  remoteAccountId: string;
  name: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  accountId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceRecord {
  id: string;
  accountId: string;
  kind: ResourceKind;
  remoteId: string;
  name: string;
  ownership: ResourceOwnership;
  remoteStatus: string | null;
  remoteUpdatedAt: string | null;
  lastSyncedAt: string;
  syncState: SyncState;
  metadata: Record<string, unknown>;
  metadataSchemaVersion: number;
}

export interface NormalizedResource {
  remoteId: string;
  name: string;
  remoteStatus: string | null;
  remoteUpdatedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface ProjectResourceLinkRecord {
  projectId: string;
  resourceId: string;
  role: string | null;
  linkedBy: "user" | "agent" | "import";
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  accountId: string | null;
  initiator: "gui" | "cli" | "agent" | "mcp" | "sync";
  action: string;
  target: string | null;
  result: "succeeded" | "failed" | "partial" | "observed";
  correlationId: string;
  summary: string;
  createdAt: string;
}

export interface AdapterSyncResult {
  kind: ResourceKind;
  success: boolean;
  count?: number;
  errorCode?: string;
}

export interface SyncResult {
  accountId: string;
  startedAt: string;
  finishedAt: string;
  partial: boolean;
  adapters: AdapterSyncResult[];
}
