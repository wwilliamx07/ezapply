import { Entry } from "@napi-rs/keyring";

/** Where tokens and client secrets live. The OS keychain in production; memory in tests. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Windows Credential Manager / macOS Keychain / libsecret, via @napi-rs/keyring. */
export class KeyringStore implements SecretStore {
  constructor(private readonly service = "ezapply") {}

  async get(key: string): Promise<string | null> {
    try {
      return new Entry(this.service, key).getPassword() ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    new Entry(this.service, key).setPassword(value);
  }

  async delete(key: string): Promise<void> {
    try {
      new Entry(this.service, key).deletePassword();
    } catch {
      // already absent
    }
  }
}

export class MemoryStore implements SecretStore {
  private readonly map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}
