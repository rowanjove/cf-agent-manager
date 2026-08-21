import { z } from "zod";

import { RESOURCE_KINDS } from "../core/domain";

export const ipcSchemas = {
  "accounts:discover": z.object({ token: z.string().trim().min(20).max(512) }).strict(),
  "accounts:connect": z.object({
    token: z.string().trim().min(20).max(512),
    remoteAccountId: z.string().regex(/^[a-f0-9]{32}$/i),
    name: z.string().trim().min(1).max(100),
  }).strict(),
  "accounts:setActive": z.object({ accountId: z.uuid() }).strict(),
  "resources:list": z.object({
    kind: z.enum(RESOURCE_KINDS).optional(), ownership: z.enum(["managed", "external"]).optional(),
  }).strict(),
  "resources:get": z.object({ resourceId: z.uuid() }).strict(),
  "resources:adoptConfirmation": z.object({ resourceId: z.uuid() }).strict(),
  "resources:adopt": z.object({ resourceId: z.uuid(), authorization: z.uuid() }).strict(),
  "projects:create": z.object({
    name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  }).strict(),
  "projects:linkResource": z.object({
    projectId: z.uuid(), resourceId: z.uuid(), role: z.string().trim().min(1).max(40).nullable().optional(),
  }).strict(),
  "projects:unlinkResource": z.object({ projectId: z.uuid(), resourceId: z.uuid() }).strict(),
  "activity:list": z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
  "settings:save": z.object({ language: z.enum(["zh-CN", "en"]) }).strict(),
  "deploy:inspect": z.object({ path: z.string().trim().min(1).max(32767) }).strict(),
  "deploy:build": z.object({ path: z.string().trim().min(1).max(32767) }).strict(),
};

export function parseIpc<T extends keyof typeof ipcSchemas>(channel: T, input: unknown): z.infer<(typeof ipcSchemas)[T]> {
  return ipcSchemas[channel].parse(input) as z.infer<(typeof ipcSchemas)[T]>;
}
