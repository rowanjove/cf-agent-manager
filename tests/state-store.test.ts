import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StateStore } from "../src/state/state-store";

describe("StateStore", () => {
  let state: StateStore;
  beforeEach(() => { state = new StateStore(); });
  afterEach(() => state.close());

  it("preserves managed ownership during remote upsert", () => {
    const account = state.saveAccount({ remoteAccountId: "a".repeat(32), name: "Test", activate: true });
    state.upsertResources(account.id, "worker", [{ remoteId: "api", name: "api", remoteStatus: "deployed", remoteUpdatedAt: null, metadata: {} }], "2026-01-01T00:00:00Z");
    const initial = state.listResources()[0]!;
    state.adoptResource(initial.id);
    state.upsertResources(account.id, "worker", [{ remoteId: "api", name: "renamed-api", remoteStatus: "deployed", remoteUpdatedAt: null, metadata: {} }], "2026-01-02T00:00:00Z");
    expect(state.listResources()[0]).toMatchObject({ ownership: "managed", name: "renamed-api", syncState: "fresh" });
  });

  it("marks unseen resources missing without deleting them", () => {
    const account = state.saveAccount({ remoteAccountId: "b".repeat(32), name: "Test", activate: true });
    state.upsertResources(account.id, "pages_project", [{ remoteId: "site", name: "site", remoteStatus: null, remoteUpdatedAt: null, metadata: {} }], "2026-01-01T00:00:00Z");
    state.markMissing(account.id, "pages_project", []);
    expect(state.listResources()).toHaveLength(1);
    expect(state.listResources()[0]?.syncState).toBe("remote_missing");
  });

  it("defaults to Chinese and persists the selected language", () => {
    expect(state.getSetting("language", "zh-CN")).toBe("zh-CN");
    state.saveSetting("language", "en");
    expect(state.getSetting("language", "zh-CN")).toBe("en");
  });
});
