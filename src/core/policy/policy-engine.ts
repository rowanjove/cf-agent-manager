import { createHash, randomUUID } from "node:crypto";

import { AppError } from "../errors";

export type PolicyRisk = "read" | "safe_write" | "sensitive_write" | "destructive";
export type PolicyDecision = "allow" | "confirm" | "deny";
export type Initiator = "gui" | "cli" | "agent" | "mcp";

export interface AgentPolicy {
  read: "allow";
  deployManaged: PolicyDecision;
  editManaged: PolicyDecision;
  editExternal: PolicyDecision;
  dnsWrite: PolicyDecision;
  secretsWrite: PolicyDecision;
  destructive: Exclude<PolicyDecision, "allow">;
}

export const DEFAULT_POLICY: AgentPolicy = {
  read: "allow",
  deployManaged: "allow",
  editManaged: "confirm",
  editExternal: "confirm",
  dnsWrite: "confirm",
  secretsWrite: "confirm",
  destructive: "confirm",
};

export interface PolicyRequest {
  initiator: Initiator;
  action: string;
  targetId: string;
  ownership?: "managed" | "external";
  risk: PolicyRisk;
  category?: "deploy" | "dns" | "secrets" | "edit";
  payload?: unknown;
  authorization?: string;
}

interface AuthorizationGrant {
  token: string;
  fingerprint: string;
  expiresAt: number;
  initiator: Initiator;
}

export class PolicyEngine {
  readonly #grants = new Map<string, AuthorizationGrant>();

  constructor(private readonly policy: AgentPolicy = DEFAULT_POLICY) {}

  decide(request: PolicyRequest): PolicyDecision {
    if (request.risk === "read") return "allow";
    if (request.risk === "destructive") return this.policy.destructive;
    if (request.category === "dns") return this.policy.dnsWrite;
    if (request.category === "secrets") return this.policy.secretsWrite;
    if (request.category === "deploy" && request.ownership !== "external") return this.policy.deployManaged;
    return request.ownership === "external" ? this.policy.editExternal : this.policy.editManaged;
  }

  authorize(request: PolicyRequest): void {
    const decision = this.decide(request);
    if (decision === "allow") return;
    if (decision === "deny") throw new AppError("POLICY_DENIED", "This action is denied by policy", false);
    const grant = request.authorization ? this.#grants.get(request.authorization) : undefined;
    if (!grant || grant.expiresAt < Date.now() || grant.initiator !== request.initiator || grant.fingerprint !== fingerprint(request)) {
      throw new AppError("CONFIRMATION_REQUIRED", "This action requires explicit confirmation", true);
    }
    this.#grants.delete(grant.token);
  }

  issueConfirmation(request: Omit<PolicyRequest, "authorization">, ttlMs = 60_000): string {
    if (this.decide(request) !== "confirm") throw new AppError("INPUT_INVALID", "Action is not confirmable");
    const token = randomUUID();
    this.#grants.set(token, {
      token,
      initiator: request.initiator,
      fingerprint: fingerprint(request),
      expiresAt: Date.now() + ttlMs,
    });
    return token;
  }
}

function fingerprint(request: Omit<PolicyRequest, "authorization">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      initiator: request.initiator,
      action: request.action,
      targetId: request.targetId,
      ownership: request.ownership,
      risk: request.risk,
      category: request.category,
      payload: request.payload,
    }))
    .digest("hex");
}
