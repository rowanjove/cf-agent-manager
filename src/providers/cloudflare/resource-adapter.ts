import type { NormalizedResource, ResourceCapability, ResourceKind } from "../../core/domain";
import type { CloudflareClient } from "./client/cloudflare-client";

export interface AdapterContext {
  accountId: string;
  client: CloudflareClient;
}

export interface ResourceAdapter<TSummary = unknown, TDetails = TSummary> {
  readonly kind: ResourceKind;
  readonly capabilities: ReadonlySet<ResourceCapability>;
  list(ctx: AdapterContext): Promise<TSummary[]>;
  get(ctx: AdapterContext, remoteId: string): Promise<TDetails>;
  normalizeSummary(input: TSummary): NormalizedResource;
  normalizeDetails(input: TDetails): NormalizedResource;
}

export abstract class ReadAdapter<TSummary, TDetails = TSummary> implements ResourceAdapter<TSummary, TDetails> {
  abstract readonly kind: ResourceKind;
  readonly capabilities = new Set<ResourceCapability>(["discover", "inspect"]);
  abstract list(ctx: AdapterContext): Promise<TSummary[]>;
  abstract get(ctx: AdapterContext, remoteId: string): Promise<TDetails>;
  abstract normalizeSummary(input: TSummary): NormalizedResource;
  normalizeDetails(input: TDetails): NormalizedResource {
    return this.normalizeSummary(input as unknown as TSummary);
  }
}

export function safeMetadata(input: Record<string, unknown>, allowedKeys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(allowedKeys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}
