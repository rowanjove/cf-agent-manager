import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "./errors";

export interface PathSecurityOptions {
  allowedPaths?: readonly string[];
  deniedPaths?: readonly string[];
}

export function assertPathAllowed(input: string, options: PathSecurityOptions = {}): string {
  const resolved = resolveCanonical(input);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new AppError("PROJECT_NOT_FOUND", "Selected project directory does not exist");
  }

  const allowed = (options.allowedPaths ?? []).map(resolveCanonicalIfPossible);
  const denied = [...builtInDeniedPaths(resolved), ...(options.deniedPaths ?? []).map(resolveCanonicalIfPossible)];
  const matchingDenied = denied.filter((candidate) => isWithin(resolved, candidate));
  const matchingAllowed = allowed.filter((candidate) => isWithin(resolved, candidate));

  if (matchingDenied.length > 0) {
    const explicitlyOverridden = matchingAllowed.some((allow) => matchingDenied.some((deny) => isStrictDescendant(allow, deny)));
    if (!explicitlyOverridden) throw new AppError("PATH_NOT_ALLOWED", "Selected directory is protected by the path security policy");
  }
  if (allowed.length > 0 && matchingAllowed.length === 0) {
    throw new AppError("PATH_NOT_ALLOWED", "Selected directory is outside the configured workspaces");
  }
  return resolved;
}

export function isWithin(candidate: string, parent: string): boolean {
  const child = normalizeForComparison(candidate);
  const root = normalizeForComparison(parent);
  if (child === root) return true;
  const relative = path.win32.relative(root, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.win32.sep}`) && !path.win32.isAbsolute(relative);
}

function resolveCanonical(input: string): string {
  const resolved = path.resolve(stripLongPathPrefix(input.trim()));
  return existsSync(resolved) ? stripLongPathPrefix(realpathSync.native(resolved)) : resolved;
}

function resolveCanonicalIfPossible(input: string): string {
  const resolved = path.resolve(stripLongPathPrefix(input.trim()));
  return existsSync(resolved) ? stripLongPathPrefix(realpathSync.native(resolved)) : resolved;
}

function normalizeForComparison(input: string): string {
  let normalized = path.win32.normalize(stripLongPathPrefix(input)).toLowerCase();
  const parsed = path.win32.parse(normalized);
  if (normalized !== parsed.root) normalized = normalized.replace(/[\\/]+$/, "");
  return normalized;
}

function stripLongPathPrefix(input: string): string {
  return input.startsWith("\\\\?\\") ? input.slice(4) : input;
}

function isStrictDescendant(candidate: string, parent: string): boolean {
  return normalizeForComparison(candidate) !== normalizeForComparison(parent) && isWithin(candidate, parent);
}

function builtInDeniedPaths(target: string): string[] {
  const parsed = path.parse(target);
  const driveRoot = parsed.root;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const usersRoot = path.join(driveRoot || "C:\\", "Users");
  const fixed = [
    driveRoot,
    systemRoot,
    path.join(systemRoot, "System32"),
    process.env.ProgramFiles ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    usersRoot,
    path.join(driveRoot || "C:\\", "$Recycle.Bin"),
  ].filter(Boolean);
  const sensitiveSegments = new Set([".ssh", ".gnupg", ".aws", "appdata", ".cf-agent"]);
  const parts = normalizeForComparison(target).split(/[\\/]+/);
  for (let index = 0; index < parts.length; index += 1) {
    if (sensitiveSegments.has(parts[index]!)) fixed.push(parts.slice(0, index + 1).join("\\"));
  }
  if (process.platform !== "win32") {
    fixed.push("/", "/etc", "/usr", "/bin", "/sbin", "/root", "/System", "/private", path.join(os.homedir(), ".ssh"), path.join(os.homedir(), ".gnupg"), path.join(os.homedir(), ".aws"));
  }
  return fixed;
}
