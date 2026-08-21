import { describe, expect, it } from "vitest";

import { parseIpc } from "../src/main/ipc-schemas";

describe("IPC schemas", () => {
  it("rejects arbitrary resource update fields", () => {
    expect(() => parseIpc("resources:list", { patch: { danger: true } })).toThrow();
  });

  it("requires a real confirmation token for adoption", () => {
    expect(() => parseIpc("resources:adopt", { resourceId: crypto.randomUUID(), confirmed: true })).toThrow();
  });

  it("only accepts supported interface languages", () => {
    expect(parseIpc("settings:save", { language: "zh-CN" })).toEqual({ language: "zh-CN" });
    expect(() => parseIpc("settings:save", { language: "fr" })).toThrow();
  });

  it("accepts a bounded deploy inspection path and rejects extra fields", () => {
    expect(parseIpc("deploy:inspect", { path: "F:\\AI\\site" })).toEqual({ path: "F:\\AI\\site" });
    expect(() => parseIpc("deploy:inspect", { path: "F:\\AI\\site", execute: true })).toThrow();
  });

  it("only accepts a path for the local build command", () => {
    expect(parseIpc("deploy:build", { path: "F:\\AI\\site" })).toEqual({ path: "F:\\AI\\site" });
    expect(() => parseIpc("deploy:build", { path: "F:\\AI\\site", command: "danger" })).toThrow();
  });
});
