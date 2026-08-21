import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/errors";
import { PolicyEngine } from "../src/core/policy/policy-engine";

describe("PolicyEngine", () => {
  it.each([
    ["read", "managed", "allow"],
    ["safe_write", "managed", "confirm"],
    ["sensitive_write", "external", "confirm"],
    ["destructive", "managed", "confirm"],
  ] as const)("maps %s / %s to %s", (risk, ownership, expected) => {
    const engine = new PolicyEngine();
    expect(engine.decide({ initiator: "agent", action: "test", targetId: "r1", risk, ownership })).toBe(expected);
  });

  it("binds a one-time confirmation to action, target, payload and initiator", () => {
    const engine = new PolicyEngine();
    const request = {
      initiator: "gui" as const, action: "resource.adopt", targetId: "r1", risk: "sensitive_write" as const,
      ownership: "external" as const, category: "edit" as const, payload: { ownership: "managed" },
    };
    const token = engine.issueConfirmation(request);
    expect(() => engine.authorize({ ...request, authorization: token })).not.toThrow();
    expect(() => engine.authorize({ ...request, authorization: token })).toThrow(AppError);
  });

  it("does not accept a payload-provided confirmed boolean", () => {
    const engine = new PolicyEngine();
    expect(() => engine.authorize({
      initiator: "agent", action: "dns.delete", targetId: "dns-1", risk: "destructive",
      category: "dns", payload: { confirmed: true },
    })).toThrowError(expect.objectContaining({ code: "CONFIRMATION_REQUIRED" }));
  });
});
