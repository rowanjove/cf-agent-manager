import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { AppError } from "../errors";
import type { PathSecurityOptions } from "../paths";
import { isWithin } from "../paths";
import { inspectLocalProject, type PackageManager } from "./local-analyzer";

export interface CommandResult { exitCode: number; output: string }
export interface CommandRunner {
  run(command: string, options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CommandResult>;
}

export interface BuildResult {
  success: true;
  operation: "build";
  status: "ready";
  project_path: string;
  output_directory: string;
  skipped_build: boolean;
}

const SECRET_ENV = /(token|secret|password|credential|private[_-]?key|authorization|cloudflare|cf_api|aws_access|aws_secret)/i;

export function sanitizedBuildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SECRET_ENV.test(key) && value !== undefined) clean[key] = value;
  }
  clean.NODE_ENV = "production";
  clean.CI = "1";
  return clean;
}

export class SpawnCommandRunner implements CommandRunner {
  async run(command: string, options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: options.cwd,
        env: options.env,
        shell: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const append = (chunk: Buffer): void => { output = `${output}${chunk.toString("utf8")}`.slice(-200_000); };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      const timer = setTimeout(() => {
        child.kill();
        reject(new AppError("BUILD_FAILED", "Build command timed out"));
      }, options.timeoutMs);
      timer.unref();
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, output }); });
    });
  }
}

export class BuildEngine {
  constructor(
    private readonly runner: CommandRunner = new SpawnCommandRunner(),
    private readonly timeoutMs = 10 * 60_000,
  ) {}

  async build(projectPath: string, security: PathSecurityOptions = {}): Promise<BuildResult> {
    const inspected = inspectLocalProject(projectPath, security);
    if (!inspected.supported) throw new AppError("UNSUPPORTED_FRAMEWORK", inspected.reason);
    const project = inspected.project;
    const outputDirectory = path.resolve(project.path, project.output_directory);
    if (!isWithin(outputDirectory, project.path)) throw new AppError("INVALID_PROJECT", "Build output escapes the project directory");

    if (project.type === "static") {
      validateOutput(outputDirectory);
      return ready(project.path, outputDirectory, true);
    }

    const manager = project.package_manager as PackageManager;
    assertRuntimeAvailable(manager);
    const env = sanitizedBuildEnvironment(process.env);
    const install = await this.runner.run(resolveBuildCommand(project.install_command!, manager), { cwd: project.path, env, timeoutMs: this.timeoutMs });
    if (install.exitCode !== 0) throw new AppError("DEPENDENCY_INSTALL_FAILED", "Dependency installation failed", true, { output: install.output.slice(-4000) });
    const built = await this.runner.run(resolveBuildCommand(project.build_command!, manager), { cwd: project.path, env, timeoutMs: this.timeoutMs });
    if (built.exitCode !== 0) throw new AppError("BUILD_FAILED", "Project build failed", true, { output: built.output.slice(-4000) });
    validateOutput(outputDirectory);
    return ready(project.path, outputDirectory, false);
  }
}

function assertRuntimeAvailable(packageManager: PackageManager): void {
  if (!process.env.CF_AGENT_PACKAGED_RUNTIME_REQUIRED) return;
  const nodePath = path.join(process.resourcesPath, "node", "node.exe");
  const managerPath = packageManager === "npm" ? path.join(process.resourcesPath, "node", "node_modules", "npm", "bin", "npm-cli.js") : "";
  if (!existsSync(nodePath) || !managerPath || !existsSync(managerPath)) {
    throw new AppError("BUNDLED_NODE_MISSING", `Bundled ${packageManager} runtime is unavailable`);
  }
}

export function resolveBuildCommand(command: string, packageManager: PackageManager): string {
  if (!process.env.CF_AGENT_PACKAGED_RUNTIME_REQUIRED) return command;
  if (packageManager !== "npm") throw new AppError("BUNDLED_NODE_MISSING", `Bundled ${packageManager} runtime is unavailable`);
  const nodePath = path.join(process.resourcesPath, "node", "node.exe");
  const npmPath = path.join(process.resourcesPath, "node", "node_modules", "npm", "bin", "npm-cli.js");
  const match = /^npm(?:\s+(.*))?$/s.exec(command.trim());
  if (!match) throw new AppError("BUILD_FAILED", "Packaged builds only allow npm commands");
  const argumentsText = match[1] ? ` ${match[1]}` : "";
  return `"${nodePath}" "${npmPath}"${argumentsText}`;
}

function validateOutput(outputDirectory: string): void {
  if (!existsSync(outputDirectory) || !statSync(outputDirectory).isDirectory() || !existsSync(path.join(outputDirectory, "index.html"))) {
    throw new AppError("OUTPUT_DIRECTORY_NOT_FOUND", "Build output directory must contain index.html");
  }
}

function ready(projectPath: string, outputDirectory: string, skippedBuild: boolean): BuildResult {
  return { success: true, operation: "build", status: "ready", project_path: projectPath, output_directory: outputDirectory, skipped_build: skippedBuild };
}
