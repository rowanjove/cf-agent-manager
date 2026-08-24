import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PagesDeployEngine, assertPagesProjectName, type PagesDeployRunner } from "../src/core/deployment/pages-deploy-engine";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function outputDirectory(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cf-agent-pages-"));
  roots.push(root);
  const output = path.join(root, "dist");
  mkdirSync(output);
  writeFileSync(path.join(output, "index.html"), "<!doctype html>");
  return output;
}

describe("PagesDeployEngine", () => {
  it("deploys validated build output without exposing credentials in the result", async () => {
    const runner: PagesDeployRunner = { run: vi.fn(async () => ({ exitCode: 0, output: "uploaded" })) };
    const engine = new PagesDeployEngine(runner);
    const result = await engine.deploy({
      outputDirectory: outputDirectory(), projectName: "my-site", accountId: "account-id",
      token: "secret-token", productionUrl: "https://my-site.pages.dev",
    });
    expect(result).toMatchObject({ project_name: "my-site", production_url: "https://my-site.pages.dev" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("fails closed when Wrangler exits unsuccessfully", async () => {
    const runner: PagesDeployRunner = { run: vi.fn(async () => ({ exitCode: 1, output: "permission denied" })) };
    await expect(new PagesDeployEngine(runner).deploy({
      outputDirectory: outputDirectory(), projectName: "my-site", accountId: "account-id",
      token: "secret-token", productionUrl: "https://my-site.pages.dev",
    })).rejects.toMatchObject({ code: "DEPLOY_FAILED" });
  });

  it("rejects unsafe project names", () => {
    expect(() => assertPagesProjectName("safe-site-1")).not.toThrow();
    expect(() => assertPagesProjectName("Unsafe Site")).toThrow();
    expect(() => assertPagesProjectName("-starts-with-dash")).toThrow();
  });
});
