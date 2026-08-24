import { describe, expect, it } from "vitest";

import { isGitBackedPages } from "../src/core/agent-core";

describe("Pages project safety", () => {
  it("distinguishes Direct Upload from Git-backed projects", () => {
    expect(isGitBackedPages(null)).toBe(false);
    expect(isGitBackedPages({})).toBe(false);
    expect(isGitBackedPages({ type: "github", config: { repo_name: "org/site" } })).toBe(true);
    expect(isGitBackedPages({ type: "gitlab" })).toBe(true);
    expect(isGitBackedPages({ config: { repo_name: "org/site" } })).toBe(true);
  });
});
