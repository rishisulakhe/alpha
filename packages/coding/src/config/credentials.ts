import { writeFileSync, readFileSync, existsSync, renameSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
}

export interface CredentialStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  getOAuth(name: string): Promise<OAuthCredential | undefined>;
  setOAuth(name: string, cred: OAuthCredential): Promise<void>;
  delete(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// FileCredentialStore
// ---------------------------------------------------------------------------

interface CredentialData {
  apiKeys: Record<string, string>;
  oauth: Record<string, OAuthCredential>;
}

export class FileCredentialStore implements CredentialStore {
  constructor(private _filePath: string) {}

  private _readData(): CredentialData {
    if (!existsSync(this._filePath)) {
      return { apiKeys: {}, oauth: {} };
    }
    try {
      const raw = readFileSync(this._filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        apiKeys: (parsed.apiKeys as Record<string, string>) ?? {},
        oauth: (parsed.oauth as Record<string, OAuthCredential>) ?? {},
      };
    } catch {
      return { apiKeys: {}, oauth: {} };
    }
  }

  private _writeData(data: CredentialData): void {
    const tempPath = join(tmpdir(), `alpha-cred-${randomUUID()}.json`);
    writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      renameSync(tempPath, this._filePath);
    } catch {
      unlinkSync(tempPath);
      throw new Error("Failed to write credentials file");
    }
  }

  async get(name: string): Promise<string | undefined> {
    const data = this._readData();
    return data.apiKeys[name];
  }

  async set(name: string, value: string): Promise<void> {
    const data = this._readData();
    data.apiKeys[name] = value;
    this._writeData(data);
  }

  async getOAuth(name: string): Promise<OAuthCredential | undefined> {
    const data = this._readData();
    return data.oauth[name];
  }

  async setOAuth(name: string, cred: OAuthCredential): Promise<void> {
    const data = this._readData();
    data.oauth[name] = cred;
    this._writeData(data);
  }

  async delete(name: string): Promise<void> {
    const data = this._readData();
    delete data.apiKeys[name];
    delete data.oauth[name];
    this._writeData(data);
  }
}
