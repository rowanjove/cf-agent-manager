import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "../src/main/security";

describe("contentSecurityPolicy", () => {
  it("permits Vite development styles and websocket updates", () => {
    const policy = contentSecurityPolicy(true);
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self' ws://localhost:*");
  });

  it("keeps production disconnected and free of inline styles", () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).toContain("style-src 'self'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).toContain("connect-src 'none'");
  });
});
