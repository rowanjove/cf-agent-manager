import type { NormalizedResource, ResourceKind } from "../../core/domain";
import type { AdapterContext } from "./resource-adapter";
import { ReadAdapter, safeMetadata } from "./resource-adapter";

type CfItem = Record<string, unknown>;

async function pagedList(ctx: AdapterContext, path: string, query: Record<string, string | number> = {}): Promise<CfItem[]> {
  const all: CfItem[] = [];
  for (let page = 1; ; page += 1) {
    const response = await ctx.client.get<CfItem[]>(path, { ...query, page, per_page: 50 });
    all.push(...response.result);
    if (!response.result_info?.total_pages || page >= response.result_info.total_pages) break;
  }
  return all;
}

abstract class AccountArrayAdapter extends ReadAdapter<CfItem> {
  abstract readonly path: string;
  async list(ctx: AdapterContext): Promise<CfItem[]> { return pagedList(ctx, this.path.replace(":account", ctx.accountId)); }
  async get(ctx: AdapterContext, remoteId: string): Promise<CfItem> {
    const items = await this.list(ctx);
    const item = items.find((candidate) => String(candidate.id ?? candidate.uuid ?? candidate.name) === remoteId);
    if (!item) throw new Error("RESOURCE_NOT_FOUND");
    return item;
  }
}

export class PagesAdapter extends AccountArrayAdapter {
  readonly kind = "pages_project" as const;
  readonly path = "/accounts/:account/pages/projects";
  normalizeSummary(item: CfItem): NormalizedResource {
    const name = String(item.name ?? item.id);
    return {
      remoteId: name, name, remoteStatus: statusOf(item), remoteUpdatedAt: dateOf(item, "latest_stage", "modified_on", "created_on"),
      metadata: safeMetadata(item, ["subdomain", "production_branch", "created_on", "domains"]),
    };
  }
}

export class WorkersAdapter extends AccountArrayAdapter {
  readonly kind = "worker" as const;
  readonly path = "/accounts/:account/workers/scripts";
  normalizeSummary(item: CfItem): NormalizedResource {
    const id = String(item.id);
    return {
      remoteId: id, name: id, remoteStatus: "deployed", remoteUpdatedAt: dateOf(item, "modified_on", "created_on"),
      metadata: safeMetadata(item, ["compatibility_date", "compatibility_flags", "has_modules", "last_deployed_from", "routes", "tags", "observability"]),
    };
  }
}

export class D1Adapter extends AccountArrayAdapter {
  readonly kind = "d1_database" as const;
  readonly path = "/accounts/:account/d1/database";
  normalizeSummary(item: CfItem): NormalizedResource {
    const id = String(item.uuid ?? item.id);
    return {
      remoteId: id, name: String(item.name ?? id), remoteStatus: "available", remoteUpdatedAt: dateOf(item, "created_at"),
      metadata: safeMetadata(item, ["created_at", "jurisdiction", "version", "file_size", "num_tables"]),
    };
  }
}

export class KVAdapter extends AccountArrayAdapter {
  readonly kind = "kv_namespace" as const;
  readonly path = "/accounts/:account/storage/kv/namespaces";
  normalizeSummary(item: CfItem): NormalizedResource {
    const id = String(item.id);
    return { remoteId: id, name: String(item.title ?? id), remoteStatus: "available", remoteUpdatedAt: null, metadata: {} };
  }
}

export class R2Adapter extends ReadAdapter<CfItem> {
  readonly kind = "r2_bucket" as const;
  async list(ctx: AdapterContext): Promise<CfItem[]> {
    const buckets: CfItem[] = [];
    let cursor: string | undefined;
    do {
      const response = await ctx.client.get<{ buckets?: CfItem[] }>(`/accounts/${ctx.accountId}/r2/buckets`, { per_page: 1000, cursor });
      buckets.push(...(response.result.buckets ?? []));
      cursor = response.result_info?.cursor || undefined;
    } while (cursor);
    return buckets;
  }
  async get(ctx: AdapterContext, remoteId: string): Promise<CfItem> {
    return (await ctx.client.get<CfItem>(`/accounts/${ctx.accountId}/r2/buckets/${encodeURIComponent(remoteId)}`)).result;
  }
  normalizeSummary(item: CfItem): NormalizedResource {
    const name = String(item.name);
    return {
      remoteId: name, name, remoteStatus: "available", remoteUpdatedAt: dateOf(item, "creation_date"),
      metadata: safeMetadata(item, ["creation_date", "jurisdiction", "location", "storage_class"]),
    };
  }
}

export class ZoneAdapter extends ReadAdapter<CfItem> {
  readonly kind = "zone" as const;
  async list(ctx: AdapterContext): Promise<CfItem[]> { return pagedList(ctx, "/zones", { "account.id": ctx.accountId }); }
  async get(ctx: AdapterContext, remoteId: string): Promise<CfItem> { return (await ctx.client.get<CfItem>(`/zones/${remoteId}`)).result; }
  normalizeSummary(item: CfItem): NormalizedResource {
    const id = String(item.id);
    return {
      remoteId: id, name: String(item.name ?? id), remoteStatus: statusOf(item), remoteUpdatedAt: dateOf(item, "modified_on", "created_on"),
      metadata: safeMetadata(item, ["type", "paused", "name_servers", "activated_on"]),
    };
  }
}

interface DnsItem extends CfItem { __zoneId?: string; __zoneName?: string }

export class DNSAdapter extends ReadAdapter<DnsItem> {
  readonly kind = "dns_record" as const;
  async list(ctx: AdapterContext): Promise<DnsItem[]> {
    const zones = await new ZoneAdapter().list(ctx);
    const results = await Promise.allSettled(zones.map(async (zone) => {
      const zoneId = String(zone.id);
      const records = await pagedList(ctx, `/zones/${zoneId}/dns_records`);
      return records.map((record) => ({ ...record, __zoneId: zoneId, __zoneName: String(zone.name) }));
    }));
    const failed = results.find((result) => result.status === "rejected");
    // Never reconcile a partial DNS view: doing so could mark records from an
    // inaccessible zone as remote_missing.
    if (failed?.status === "rejected") throw failed.reason;
    return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
  async get(ctx: AdapterContext, remoteId: string): Promise<DnsItem> {
    const [zoneId, recordId] = remoteId.split(":", 2);
    if (!zoneId || !recordId) throw new Error("RESOURCE_NOT_FOUND");
    return { ...(await ctx.client.get<CfItem>(`/zones/${zoneId}/dns_records/${recordId}`)).result, __zoneId: zoneId };
  }
  normalizeSummary(item: DnsItem): NormalizedResource {
    const zoneId = String(item.__zoneId);
    const recordId = String(item.id);
    return {
      remoteId: `${zoneId}:${recordId}`, name: String(item.name ?? recordId), remoteStatus: String(item.type ?? "record"),
      remoteUpdatedAt: dateOf(item, "modified_on", "created_on"),
      metadata: { ...safeMetadata(item, ["type", "content", "proxied", "ttl", "comment", "tags"]), zoneId, zoneName: item.__zoneName },
    };
  }
}

export const READ_ADAPTERS = [new PagesAdapter(), new WorkersAdapter(), new D1Adapter(), new KVAdapter(), new R2Adapter(), new ZoneAdapter(), new DNSAdapter()];

export function adapterByKind(kind: ResourceKind) {
  return READ_ADAPTERS.find((adapter) => adapter.kind === kind);
}

function statusOf(item: CfItem): string | null { return item.status === undefined ? null : String(item.status); }
function dateOf(item: CfItem, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "ended_on" in value && typeof value.ended_on === "string") return value.ended_on;
  }
  return null;
}
