import keytar from "keytar";

import { LEGACY_CREDENTIAL_SERVICE } from "../branding";

const SERVICE = LEGACY_CREDENTIAL_SERVICE;

export interface CredentialStore {
  getToken(remoteAccountId: string): Promise<string | null>;
  saveToken(remoteAccountId: string, token: string): Promise<void>;
  deleteToken(remoteAccountId: string): Promise<boolean>;
}

export class WindowsCredentialStore implements CredentialStore {
  getToken(remoteAccountId: string): Promise<string | null> {
    return keytar.getPassword(SERVICE, remoteAccountId);
  }

  async saveToken(remoteAccountId: string, token: string): Promise<void> {
    await keytar.setPassword(SERVICE, remoteAccountId, token);
  }

  deleteToken(remoteAccountId: string): Promise<boolean> {
    return keytar.deletePassword(SERVICE, remoteAccountId);
  }
}

export class MemoryCredentialStore implements CredentialStore {
  readonly #tokens = new Map<string, string>();
  async getToken(remoteAccountId: string): Promise<string | null> { return this.#tokens.get(remoteAccountId) ?? null; }
  async saveToken(remoteAccountId: string, token: string): Promise<void> { this.#tokens.set(remoteAccountId, token); }
  async deleteToken(remoteAccountId: string): Promise<boolean> { return this.#tokens.delete(remoteAccountId); }
}
