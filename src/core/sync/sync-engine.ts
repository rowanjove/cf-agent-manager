import { randomUUID } from "node:crypto";

import type { AccountRecord, ResourceKind, SyncResult } from "../domain";
import { toPublicError } from "../errors";
import type { CredentialStore } from "../../credentials/credential-store";
import { CloudflareClient } from "../../providers/cloudflare/client/cloudflare-client";
import type { ResourceRegistry } from "../../providers/cloudflare/registry";
import type { StateStore } from "../../state/state-store";

export type SyncProgressHandler = (event: { kind: ResourceKind; state: "started" | "succeeded" | "failed"; count?: number }) => void;

export class SyncEngine {
  constructor(
    private readonly state: StateStore,
    private readonly credentials: CredentialStore,
    private readonly registry: ResourceRegistry,
    private readonly clientFactory: (token: string) => CloudflareClient = (token) => new CloudflareClient(token),
  ) {}

  async sync(account: AccountRecord, onProgress?: SyncProgressHandler): Promise<SyncResult> {
    const startedAt = new Date().toISOString();
    const token = await this.credentials.getToken(account.remoteAccountId);
    if (!token) throw new Error("ACCOUNT_NOT_CONFIGURED");
    const client = this.clientFactory(token);
    const adapters = await Promise.all(this.registry.all().map(async (adapter) => {
      onProgress?.({ kind: adapter.kind, state: "started" });
      try {
        const summaries = await adapter.list({ accountId: account.remoteAccountId, client });
        const normalized = summaries.map((item) => adapter.normalizeSummary(item));
        const syncedAt = new Date().toISOString();
        this.state.upsertResources(account.id, adapter.kind, normalized, syncedAt);
        this.state.markMissing(account.id, adapter.kind, normalized.map((item) => item.remoteId));
        onProgress?.({ kind: adapter.kind, state: "succeeded", count: normalized.length });
        return { kind: adapter.kind, success: true, count: normalized.length } as const;
      } catch (error) {
        const publicError = toPublicError(error);
        onProgress?.({ kind: adapter.kind, state: "failed" });
        return { kind: adapter.kind, success: false, errorCode: publicError.code } as const;
      }
    }));
    const result: SyncResult = {
      accountId: account.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      partial: adapters.some((adapter) => !adapter.success),
      adapters,
    };
    this.state.recordSync(result);
    this.state.addActivity({
      accountId: account.id, initiator: "sync", action: "account.sync", target: account.remoteAccountId,
      result: result.partial ? "partial" : "succeeded", correlationId: `sync_${randomUUID()}`,
      summary: result.partial ? "Account sync completed with unavailable services" : "Account sync completed",
    });
    return result;
  }
}
