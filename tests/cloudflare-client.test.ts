import { describe, expect, it, vi } from "vitest";

import { CloudflareClient } from "../src/providers/cloudflare/client/cloudflare-client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("CloudflareClient", () => {
  it("verifies an active token without exposing it in the URL", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.toString()).toBe("https://api.cloudflare.com/client/v4/user/tokens/verify");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
      return json({ success: true, result: { id: "token-id", status: "active" } });
    });
    await expect(new CloudflareClient("test-token", undefined, fetcher as typeof fetch).verifyToken()).resolves.toEqual({ id: "token-id", status: "active" });
  });

  it("paginates account discovery", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      const page = url.searchParams.get("page");
      return json({ success: true, result: [{ id: `id-${page}`, name: `Account ${page}` }], result_info: { page: Number(page), total_pages: 2 } });
    });
    await expect(new CloudflareClient("token", undefined, fetcher as typeof fetch).listAccounts()).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([[401, "AUTH_INVALID"], [403, "AUTH_FORBIDDEN"], [429, "CF_RATE_LIMITED"]])("maps HTTP %s to %s", async (status, code) => {
    const fetcher = vi.fn(async () => json({ success: false, result: null }, status as number));
    await expect(new CloudflareClient("token", undefined, fetcher as typeof fetch).get("/accounts")).rejects.toMatchObject({ code });
  });
});
