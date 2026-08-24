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

  it("sends JSON bodies for Pages project creation", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe("/client/v4/accounts/account-id/pages/projects");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ name: "my-site", production_branch: "main" });
      return json({ success: true, result: { name: "my-site", subdomain: "my-site.pages.dev" } });
    });
    await expect(new CloudflareClient("token", undefined, fetcher as typeof fetch).post(
      "/accounts/account-id/pages/projects",
      { name: "my-site", production_branch: "main" },
    )).resolves.toMatchObject({ result: { name: "my-site" } });
  });

  it("verifies Pages access for a manually supplied account", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe("/client/v4/accounts/0123456789abcdef0123456789abcdef/pages/projects");
      expect(url.searchParams.get("per_page")).toBe("1");
      expect(init?.method).toBe("GET");
      return json({ success: true, result: [] });
    });

    await expect(new CloudflareClient("token", undefined, fetcher as typeof fetch)
      .verifyPagesAccountAccess("0123456789abcdef0123456789abcdef")).resolves.toBeUndefined();
  });

  it.each([[401, "AUTH_INVALID"], [403, "AUTH_FORBIDDEN"], [429, "CF_RATE_LIMITED"]])("maps HTTP %s to %s", async (status, code) => {
    const fetcher = vi.fn(async () => json({ success: false, result: null }, status as number));
    await expect(new CloudflareClient("token", undefined, fetcher as typeof fetch).get("/accounts")).rejects.toMatchObject({ code });
  });

  it("preserves an HTTP status for conflict handling", async () => {
    const fetcher = vi.fn(async () => json({ success: false, result: null, errors: [{ message: "not found" }] }, 404));
    await expect(new CloudflareClient("token", undefined, fetcher as typeof fetch).get("/missing"))
      .rejects.toMatchObject({ code: "CF_API_ERROR", details: { status: 404 } });
  });
});
