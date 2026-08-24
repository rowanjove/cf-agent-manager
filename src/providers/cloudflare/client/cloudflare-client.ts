import { AppError } from "../../../core/errors";

export interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
  result_info?: { page?: number; total_pages?: number; cursor?: string };
}

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://api.cloudflare.com/client/v4",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<CloudflareEnvelope<T>> {
    return this.request<T>("GET", path, query);
  }

  async post<T>(path: string, body: unknown): Promise<CloudflareEnvelope<T>> {
    return this.request<T>("POST", path, undefined, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<CloudflareEnvelope<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError("CF_NETWORK_ERROR", "Could not reach Cloudflare", true, { cause: error instanceof Error ? error.name : "unknown" });
    }
    if (response.status === 401) throw new AppError("AUTH_INVALID", "Cloudflare token is invalid or expired");
    if (response.status === 403) throw new AppError("AUTH_FORBIDDEN", "Cloudflare token lacks a required permission");
    if (response.status === 429) throw new AppError("CF_RATE_LIMITED", "Cloudflare rate limit reached");
    let envelope: CloudflareEnvelope<T>;
    try {
      envelope = await response.json() as CloudflareEnvelope<T>;
    } catch {
      throw new AppError("CF_API_ERROR", `Cloudflare returned an invalid response (${response.status})`);
    }
    if (!response.ok || !envelope.success) {
      const message = envelope.errors?.map((item) => item.message).filter(Boolean).join("; ") || `Cloudflare API error (${response.status})`;
      throw new AppError("CF_API_ERROR", message, response.status >= 500, { status: response.status });
    }
    return envelope;
  }

  async verifyToken(): Promise<{ id: string; status: string }> {
    const { result } = await this.get<{ id: string; status: string }>("/user/tokens/verify");
    if (result.status !== "active") throw new AppError("AUTH_INVALID", `Cloudflare token is ${result.status}`);
    return result;
  }

  async listAccounts(): Promise<Array<{ id: string; name: string }>> {
    const accounts: Array<{ id: string; name: string }> = [];
    for (let page = 1; ; page += 1) {
      const response = await this.get<Array<{ id: string; name: string }>>("/accounts", { page, per_page: 50 });
      accounts.push(...response.result);
      if (!response.result_info?.total_pages || page >= response.result_info.total_pages) break;
    }
    return accounts;
  }

  async verifyPagesAccountAccess(accountId: string): Promise<void> {
    await this.get<Array<{ name: string }>>(`/accounts/${accountId}/pages/projects`, { page: 1, per_page: 1 });
  }
}
