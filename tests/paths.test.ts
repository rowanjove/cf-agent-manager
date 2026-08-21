import { describe, expect, it } from "vitest";

import { isWithin } from "../src/core/paths";

describe("Windows path containment", () => {
  it("is case-insensitive and accepts the long path prefix", () => {
    expect(isWithin("\\\\?\\C:\\AIProjects\\Calculator", "c:\\aiprojects")).toBe(true);
  });

  it("does not confuse sibling prefixes with descendants", () => {
    expect(isWithin("C:\\AIProjects-evil\\site", "C:\\AIProjects")).toBe(false);
  });

  it("supports nested user workspaces", () => {
    expect(isWithin("C:\\Users\\Ryan\\projects\\site", "C:\\Users\\Ryan\\projects")).toBe(true);
  });
});
