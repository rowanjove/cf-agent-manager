import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { AppError } from "../errors";

export interface PagesDeployCommandResult { exitCode: number; output: string }
export interface PagesDeployRunner {
  run(input: {
    outputDirectory: string;
    projectName: string;
    accountId: string;
    token: string;
    timeoutMs: number;
  }): Promise<PagesDeployCommandResult>;
}

export interface PagesDeployResult {
  success: true;
  operation: "deploy";
  project_name: string;
  production_url: string;
  output_directory: string;
}

const require = createRequire(import.meta.url);

export class WranglerPagesDeployRunner implements PagesDeployRunner {
  async run(input: {
    outputDirectory: string;
    projectName: string;
    accountId: string;
    token: string;
    timeoutMs: number;
  }): Promise<PagesDeployCommandResult> {
    const { executable, entry } = resolveWranglerRuntime();
    const args = [
      entry, "pages", "deploy", input.outputDirectory,
      "--project-name", input.projectName,
      "--branch", "main",
      "--commit-dirty=true",
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      HTTP_PROXY: process.env.HTTP_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      CLOUDFLARE_ACCOUNT_ID: input.accountId,
      CLOUDFLARE_API_TOKEN: input.token,
      CI: "1",
      NODE_ENV: "production",
    };
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: input.outputDirectory,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const append = (chunk: Buffer): void => {
        output = `${output}${chunk.toString("utf8")}`.replaceAll(input.token, "[REDACTED]").slice(-200_000);
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      const timer = setTimeout(() => {
        child.kill();
        reject(new AppError("DEPLOY_FAILED", "Cloudflare Pages deployment timed out"));
      }, input.timeoutMs);
      timer.unref();
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new AppError("DEPLOY_FAILED", "Could not start Wrangler", true, { cause: error.name }));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, output });
      });
    });
  }
}

export class PagesDeployEngine {
  constructor(
    private readonly runner: PagesDeployRunner = new WranglerPagesDeployRunner(),
    private readonly timeoutMs = 10 * 60_000,
  ) {}

  async deploy(input: {
    outputDirectory: string;
    projectName: string;
    accountId: string;
    token: string;
    productionUrl: string;
  }): Promise<PagesDeployResult> {
    if (!existsSync(path.join(input.outputDirectory, "index.html"))) {
      throw new AppError("OUTPUT_DIRECTORY_NOT_FOUND", "Build output directory must contain index.html");
    }
    assertPagesProjectName(input.projectName);
    const result = await this.runner.run({ ...input, timeoutMs: this.timeoutMs });
    if (result.exitCode !== 0) {
      throw new AppError("DEPLOY_FAILED", "Cloudflare Pages deployment failed", true, { output: result.output.slice(-4000) });
    }
    return {
      success: true,
      operation: "deploy",
      project_name: input.projectName,
      production_url: input.productionUrl,
      output_directory: input.outputDirectory,
    };
  }
}

export function assertPagesProjectName(value: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(value)) {
    throw new AppError("INPUT_INVALID", "Pages project name must use 1-58 lowercase letters, numbers, or hyphens");
  }
}

function resolveWranglerRuntime(): { executable: string; entry: string } {
  if (process.env.CF_AGENT_PACKAGED_RUNTIME_REQUIRED) {
    const executable = path.join(process.resourcesPath, "node", "node.exe");
    const entry = path.join(process.resourcesPath, "wrangler", "wrangler-dist", "cli.js");
    if (!existsSync(executable) || !existsSync(entry)) {
      throw new AppError("BUNDLED_NODE_MISSING", "Bundled Node.js and Wrangler runtimes are unavailable");
    }
    return { executable, entry };
  }
  return { executable: "node", entry: require.resolve("wrangler") };
}
