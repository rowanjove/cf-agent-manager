import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "../src/core/errors";
import { inspectLocalProject } from "../src/core/deployment/local-analyzer";

const temporaryDirectories: string[] = [];

function project(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cf-agent-analyzer-"));
  temporaryDirectories.push(directory);
  return directory;
}

function inspect(directory: string) {
  return inspectLocalProject(directory, { allowedPaths: [directory] });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local project analyzer", () => {
  it("recognizes static HTML without a build step", () => {
    const directory = project();
    writeFileSync(path.join(directory, "index.html"), "<!doctype html>");
    expect(inspect(directory)).toMatchObject({
      supported: true,
      project: { type: "static", framework: "html", package_manager: null, build_command: null, output: "." },
    });
  });

  it("recognizes React plus Vite and honors literal outDir", () => {
    const directory = project();
    writeFileSync(path.join(directory, "index.html"), "<div id='root'></div>");
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({
      scripts: { build: "vite build" }, devDependencies: { vite: "latest", react: "latest", vue: "latest" },
    }));
    writeFileSync(path.join(directory, "package-lock.json"), "{}");
    writeFileSync(path.join(directory, "vite.config.ts"), "export default { build: { outDir: 'public-dist' } }");
    expect(inspect(directory)).toMatchObject({
      supported: true,
      project: { type: "vite", framework: "react", package_manager: "npm", build_command: "npm run build", output: "public-dist" },
      warnings: ["both_react_vue"],
    });
  });

  it("returns supported false for known unsupported frameworks", () => {
    const directory = project();
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { next: "latest", react: "latest" } }));
    expect(inspect(directory)).toMatchObject({ success: true, supported: false, reason_code: "UNSUPPORTED_FRAMEWORK" });
  });

  it("does not scan nested monorepo packages", () => {
    const directory = project();
    mkdirSync(path.join(directory, "apps", "web"), { recursive: true });
    writeFileSync(path.join(directory, "apps", "web", "index.html"), "nested");
    expect(() => inspect(directory)).toThrowError(expect.objectContaining({ code: "INVALID_PROJECT" }));
  });

  it("gives packageManager field priority and reads safe yaml overrides", () => {
    const directory = project();
    writeFileSync(path.join(directory, "index.html"), "root");
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0", devDependencies: { vite: "latest" } }));
    writeFileSync(path.join(directory, "package-lock.json"), "{}");
    writeFileSync(path.join(directory, "cf-agent.yaml"), "build:\n  command: pnpm run release\n  output: site\n");
    expect(inspect(directory)).toMatchObject({
      supported: true, project: { package_manager: "pnpm", build_command: "pnpm run release", output: "site" },
    });
  });

  it("rejects protected paths unless a more specific workspace is explicit", () => {
    const directory = project();
    writeFileSync(path.join(directory, "index.html"), "root");
    expect(() => inspectLocalProject(directory, { deniedPaths: [directory] })).toThrow(AppError);
  });

  it("rejects output directories outside the selected project", () => {
    const directory = project();
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ devDependencies: { vite: "latest" } }));
    writeFileSync(path.join(directory, "cf-agent.yaml"), "build:\n  output: ../escaped\n");
    expect(() => inspect(directory)).toThrowError(expect.objectContaining({ code: "INVALID_PROJECT" }));
  });
});
