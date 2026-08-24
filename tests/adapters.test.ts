import { describe, expect, it } from "vitest";

import { DNSAdapter, PagesAdapter, R2Adapter, WorkersAdapter } from "../src/providers/cloudflare/adapters";

describe("Cloudflare read adapters", () => {
  it("declares only implemented capabilities", () => {
    expect([...new PagesAdapter().capabilities]).toEqual(["discover", "inspect"]);
    expect(new WorkersAdapter().capabilities.has("deploy")).toBe(false);
  });

  it("normalizes Pages without retaining arbitrary payload fields", () => {
    const normalized = new PagesAdapter().normalizeSummary({
      id: "uuid", name: "site", subdomain: "site.pages.dev", production_branch: "main", secret: "must-not-leak",
    });
    expect(normalized).toMatchObject({ remoteId: "site", name: "site" });
    expect(normalized.metadata).not.toHaveProperty("secret");
  });

  it("uses the Pages API maximum page size", async () => {
    const calls: Array<Record<string, string | number | undefined>> = [];
    const ctx = {
      accountId: "account",
      client: {
        get: async (_path: string, query: Record<string, string | number | undefined>) => {
          calls.push(query);
          return { success: true, result: [], result_info: { page: 1, total_pages: 1 } };
        },
      },
    };

    await new PagesAdapter().list(ctx as never);

    expect(calls[0]?.per_page).toBe(10);
  });

  it("normalizes an R2 bucket using its name as remote identity", () => {
    expect(new R2Adapter().normalizeSummary({ name: "assets", location: "apac" })).toMatchObject({
      remoteId: "assets", name: "assets", metadata: { location: "apac" },
    });
  });

  it("uses a zone-qualified DNS remote identity", () => {
    expect(new DNSAdapter().normalizeSummary({ id: "record", name: "www.example.com", type: "CNAME", __zoneId: "zone" }).remoteId).toBe("zone:record");
  });
});
