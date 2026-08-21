import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BuildEngine, resolveBuildCommand, sanitizedBuildEnvironment, SpawnCommandRunner, type CommandRunner } from "../src/core/deployment/build-engine";

const temporaryDirectories: string[] = [];
function project(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cf-agent-build-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("BuildEngine", () => {
  it("validates a static site without running commands", async () => {
    const directory = project();
    writeFileSync(path.join(directory, "index.html"), "<!doctype html>");
    const runner: CommandRunner = { run: async () => { throw new Error("should not run"); } };
    await expect(new BuildEngine(runner).build(directory, { allowedPaths: [directory] })).resolves.toMatchObject({ status: "ready", skipped_build: true });
  });

  it("installs, builds and validates Vite output", async () => {
    const directory = project();
    writeFileSync(path.join(directory, "index.html"), "source");
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "latest" } }));
    const commands: string[] = [];
    const runner: CommandRunner = { run: async (command) => {
      commands.push(command);
      if (commands.length === 2) {
        mkdirSync(path.join(directory, "dist"));
        writeFileSync(path.join(directory, "dist", "index.html"), "built");
      }
      return { exitCode: 0, output: "ok" };
    } };
    await expect(new BuildEngine(runner).build(directory, { allowedPaths: [directory] })).resolves.toMatchObject({ status: "ready", skipped_build: false });
    expect(commands).toEqual(["npm install", "npm run build"]);
  });

  it("does not pass credentials into project scripts", () => {
    const env = sanitizedBuildEnvironment({ PATH: "bin", CLOUDFLARE_API_TOKEN: "secret", AWS_SECRET_ACCESS_KEY: "secret", SAFE_FLAG: "yes" });
    expect(env).toMatchObject({ PATH: "bin", SAFE_FLAG: "yes", NODE_ENV: "production", CI: "1" });
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("keeps development commands unchanged", () => {
    expect(resolveBuildCommand("npm run build", "npm")).toBe("npm run build");
  });

  it("runs a local command and captures its output", async () => {
    const result = await new SpawnCommandRunner().run(`"${process.execPath}" -e "process.stdout.write('runner-ok')"`, {
      cwd: process.cwd(), env: sanitizedBuildEnvironment(process.env), timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ exitCode: 0, output: "runner-ok" });
  });
});
