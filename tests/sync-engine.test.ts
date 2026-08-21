import { afterEach, describe, expect, it } from "vitest";

import type { NormalizedResource } from "../src/core/domain";
import { SyncEngine } from "../src/core/sync/sync-engine";
import { MemoryCredentialStore } from "../src/credentials/credential-store";
import { CloudflareClient } from "../src/providers/cloudflare/client/cloudflare-client";
import { ResourceRegistry } from "../src/providers/cloudflare/registry";
import { ReadAdapter } from "../src/providers/cloudflare/resource-adapter";
import { StateStore } from "../src/state/state-store";

class FakeAdapter extends ReadAdapter<Record<string, unknown>> {
  constructor(readonly kind: "worker" | "pages_project", private readonly items: Record<string, unknown>[] | Error) { super(); }
  async list(): Promise<Record<string, unknown>[]> { if (this.items instanceof Error) throw this.items; return this.items; }
  async get(): Promise<Record<string, unknown>> { return {}; }
  normalizeSummary(item: Record<string, unknown>): NormalizedResource {
    return { remoteId: String(item.id), name: String(item.name), remoteStatus: null, remoteUpdatedAt: null, metadata: {} };
  }
}

describe("SyncEngine", () => {
  const stores: StateStore[] = [];
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it("commits successful adapters and preserves cache for failed adapters", async () => {
    const state = new StateStore(); stores.push(state);
    const account = state.saveAccount({ remoteAccountId: "c".repeat(32), name: "Test", activate: true });
    state.upsertResources(account.id, "pages_project", [{ remoteId: "cached", name: "cached", remoteStatus: null, remoteUpdatedAt: null, metadata: {} }], new Date().toISOString());
    const credentials = new MemoryCredentialStore(); await credentials.saveToken(account.remoteAccountId, "token");
    const registry = new ResourceRegistry([
      new FakeAdapter("worker", [{ id: "api", name: "api" }]),
      new FakeAdapter("pages_project", new Error("permission denied")),
    ]);
    const engine = new SyncEngine(state, credentials, registry, () => new CloudflareClient("token", "https://invalid.example"));
    const result = await engine.sync(account);
    expect(result.partial).toBe(true);
    expect(state.listResources({ kind: "worker" })).toHaveLength(1);
    expect(state.listResources({ kind: "pages_project" })[0]).toMatchObject({ remoteId: "cached", syncState: "fresh" });
  });
});
