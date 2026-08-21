import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

import { AppError } from "../errors";
import { assertPathAllowed, isWithin, type PathSecurityOptions } from "../paths";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type LocalFramework = "html" | "vite" | "react" | "vue";

export interface SupportedInspectResult {
  success: true;
  operation: "inspect";
  supported: true;
  project: {
    path: string;
    type: "static" | "vite";
    framework: LocalFramework;
    package_manager: PackageManager | null;
    install_command: string | null;
    build_command: string | null;
    output: string;
    output_directory: string;
    has_index_html: boolean;
  };
  warnings: string[];
}

export interface UnsupportedInspectResult {
  success: true;
  operation: "inspect";
  supported: false;
  reason_code: "UNSUPPORTED_FRAMEWORK";
  reason: string;
}

export type InspectResult = SupportedInspectResult | UnsupportedInspectResult;

const UNSUPPORTED_DEPENDENCIES: Array<[string, string]> = [
  ["next", "Next.js"], ["nuxt", "Nuxt"], ["astro", "Astro"], ["@sveltejs/kit", "SvelteKit"],
  ["gatsby", "Gatsby"], ["@remix-run/react", "Remix"], ["react-scripts", "Create React App"],
];
const LOCKS: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"],
];

export function inspectLocalProject(inputPath: string, security: PathSecurityOptions = {}): InspectResult {
  const projectPath = assertPathAllowed(inputPath, security);
  const packagePath = path.join(projectPath, "package.json");
  const indexPath = path.join(projectPath, "index.html");
  const hasIndexHtml = isFile(indexPath);
  if (!isFile(packagePath)) {
    if (!hasIndexHtml) throw new AppError("INVALID_PROJECT", "Project root must contain package.json or index.html");
    return supported(projectPath, "static", "html", null, null, null, ".", hasIndexHtml, []);
  }

  const packageJson = readJsonObject(packagePath);
  const dependencies = mergeStringMaps(packageJson.dependencies, packageJson.devDependencies);
  for (const [dependency, label] of UNSUPPORTED_DEPENDENCIES) {
    if (dependency in dependencies) return unsupported(`${label} is not auto-deployed in V1`);
  }
  if (!("vite" in dependencies)) return unsupported("Only static HTML and Vite projects are auto-deployed in V1");

  const warnings: string[] = [];
  const framework: LocalFramework = ("react" in dependencies || "react-dom" in dependencies)
    ? "react" : "vue" in dependencies ? "vue" : "vite";
  if (("react" in dependencies || "react-dom" in dependencies) && "vue" in dependencies) warnings.push("both_react_vue");
  const packageManager = detectPackageManager(projectPath, packageJson.packageManager, warnings);
  const yamlConfig = readProjectConfig(projectPath);
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const buildCommand = yamlConfig.buildCommand
    ?? (typeof scripts.build === "string" ? `${packageManager} run build` : `${packageManager} exec vite build`);
  const output = yamlConfig.output ?? detectOutputDirectory(projectPath, warnings);
  assertSafeOutputDirectory(projectPath, output);
  return supported(projectPath, "vite", framework, packageManager, `${packageManager} install`, buildCommand, output, hasIndexHtml, warnings);
}

function assertSafeOutputDirectory(projectPath: string, output: string): void {
  if (!output.trim() || path.isAbsolute(output)) throw new AppError("INVALID_PROJECT", "Build output must be a relative directory inside the project");
  const resolved = path.resolve(projectPath, output);
  if (!isWithin(resolved, projectPath)) throw new AppError("INVALID_PROJECT", "Build output cannot escape the selected project directory");
}

function supported(
  projectPath: string, type: "static" | "vite", framework: LocalFramework, packageManager: PackageManager | null,
  installCommand: string | null, buildCommand: string | null, output: string, hasIndexHtml: boolean, warnings: string[],
): SupportedInspectResult {
  return {
    success: true, operation: "inspect", supported: true,
    project: {
      path: projectPath, type, framework, package_manager: packageManager, install_command: installCommand,
      build_command: buildCommand, output, output_directory: output, has_index_html: hasIndexHtml,
    },
    warnings,
  };
}

function unsupported(reason: string): UnsupportedInspectResult {
  return { success: true, operation: "inspect", supported: false, reason_code: "UNSUPPORTED_FRAMEWORK", reason };
}

function detectPackageManager(projectPath: string, packageManagerField: unknown, warnings: string[]): PackageManager {
  if (typeof packageManagerField === "string") {
    const name = packageManagerField.split("@")[0];
    if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name;
  }
  const present = LOCKS.filter(([file]) => isFile(path.join(projectPath, file))).map(([, manager]) => manager);
  const unique = [...new Set(present)];
  if (unique.length > 1) warnings.push("multiple_lockfiles");
  return unique[0] ?? "npm";
}

function detectOutputDirectory(projectPath: string, warnings: string[]): string {
  const configNames = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"];
  const configPath = configNames.map((name) => path.join(projectPath, name)).find(isFile);
  if (!configPath) return "dist";
  const content = readTextLimited(configPath);
  const match = /\boutDir\s*:\s*(["'`])([^"'`]+)\1/.exec(content);
  if (!match?.[2] || match[2].includes("${")) {
    warnings.push("outdir_unparsed");
    return "dist";
  }
  return match[2];
}

function readProjectConfig(projectPath: string): { buildCommand?: string; output?: string } {
  const configPath = path.join(projectPath, "cf-agent.yaml");
  if (!isFile(configPath)) return {};
  const document = parseDocument(readTextLimited(configPath));
  if (document.errors.length) throw new AppError("INVALID_PROJECT", "cf-agent.yaml is invalid");
  const value = document.toJS({ maxAliasCount: 20 }) as unknown;
  if (!isRecord(value) || !isRecord(value.build)) return {};
  return {
    ...(typeof value.build.command === "string" ? { buildCommand: value.build.command } : {}),
    ...(typeof value.build.output === "string" ? { output: value.build.output } : {}),
  };
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readTextLimited(filePath)) as unknown;
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new AppError("INVALID_PROJECT", "package.json is invalid");
  }
}

function readTextLimited(filePath: string): string {
  if (statSync(filePath).size > 1_048_576) throw new AppError("INVALID_PROJECT", "Project configuration file is too large");
  return readFileSync(filePath, "utf8");
}

function mergeStringMaps(...values: unknown[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const value of values) if (isRecord(value)) for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") merged[key] = entry;
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isFile(filePath: string): boolean { return existsSync(filePath) && statSync(filePath).isFile(); }
