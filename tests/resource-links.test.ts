import { describe, expect, it } from "vitest";

import { pagesDashboardUrl } from "../src/renderer/resource-links";

describe("pagesDashboardUrl", () => {
  it("builds an encoded Cloudflare Pages dashboard URL", () => {
    expect(pagesDashboardUrl("account-id", "my project/中文")).toBe(
      "https://dash.cloudflare.com/account-id/pages/view/my%20project%2F%E4%B8%AD%E6%96%87",
    );
  });
});
