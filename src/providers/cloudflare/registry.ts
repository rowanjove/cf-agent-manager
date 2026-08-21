import type { ResourceKind } from "../../core/domain";
import type { ResourceAdapter } from "./resource-adapter";

export class ResourceRegistry {
  readonly #adapters = new Map<ResourceKind, ResourceAdapter>();

  constructor(adapters: readonly ResourceAdapter[]) {
    for (const adapter of adapters) {
      if (this.#adapters.has(adapter.kind)) throw new Error(`Duplicate adapter: ${adapter.kind}`);
      this.#adapters.set(adapter.kind, adapter);
    }
  }

  all(): ResourceAdapter[] { return [...this.#adapters.values()]; }
  get(kind: ResourceKind): ResourceAdapter | undefined { return this.#adapters.get(kind); }
}
