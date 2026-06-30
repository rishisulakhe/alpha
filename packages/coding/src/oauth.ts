/**
 * OAuth helpers for subscription-backed coding providers.
 *
 * Supports OpenAI Codex OAuth flow with PKCE.
 */

import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const OPENAI_CODEX_OAUTH_PROVIDER = "openai-codex";
export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
export const OPENAI_CODEX_ACCOUNT_CLAIM = "https://api.openai.com/auth";
export const OPENAI_CODEX_CALLBACK_PORT = 1455;

const TOKEN_REFRESH_SKEW_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // milliseconds since epoch
  accountId?: string;
}

export interface OAuthAuthInfo {
  url: string;
  instructions?: string;
}

export interface AuthorizationFlow {
  verifier: string;
  state: string;
  url: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

export function createPKCEPair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const digest = createHash("sha256").update(verifier).digest();
  const challenge = digest.toString("base64url");
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Authorization Flow
// ---------------------------------------------------------------------------

export function createOpenAICodexAuthorizationFlow(originator = "alpha"): AuthorizationFlow {
  const { verifier, challenge } = createPKCEPair();
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    scope: OPENAI_CODEX_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator,
  });

  return {
    verifier,
    state,
    url: `${OPENAI_CODEX_AUTHORIZE_URL}?${params.toString()}`,
  };
}

// ---------------------------------------------------------------------------
// Token Exchange
// ---------------------------------------------------------------------------

export async function exchangeOpenAICodexAuthorizationCode(
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new OAuthError(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresAt: Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
  };
}

export async function refreshOpenAICodexToken(
  refreshToken: string,
): Promise<OAuthCredential> {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OPENAI_CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new OAuthError(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const accessToken = data.access_token as string;
  const accountId = accountIdFromAccessToken(accessToken);

  return {
    accessToken,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresAt: Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
    accountId,
  };
}

// ---------------------------------------------------------------------------
// Token Utilities
// ---------------------------------------------------------------------------

export function accountIdFromAccessToken(accessToken: string): string | undefined {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return undefined;

    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64").toString("utf-8"),
    );

    const auth = payload[OPENAI_CODEX_ACCOUNT_CLAIM];
    if (typeof auth !== "object" || auth === null) return undefined;

    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    if (typeof accountId !== "string" || !accountId.trim()) return undefined;

    return accountId.trim();
  } catch {
    return undefined;
  }
}

export function oauthCredentialIsExpired(credential: OAuthCredential): boolean {
  return Date.now() >= credential.expiresAt - TOKEN_REFRESH_SKEW_MS;
}

// ---------------------------------------------------------------------------
// Local OAuth Server
// ---------------------------------------------------------------------------

interface LocalOAuthServer {
  server: Server;
  waitForCode(): Promise<string | null>;
  close(): void;
}

export async function startLocalOAuthServer(state: string): Promise<LocalOAuthServer | null> {
  let resolveCode: (code: string | null) => void;
  const codePromise = new Promise<string | null>((resolve) => {
    resolveCode = resolve;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const url = new URL(req.url, `http://localhost:${OPENAI_CODEX_CALLBACK_PORT}`);

    if (url.pathname !== "/auth/callback") {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end(_oauthHtml("Callback route not found."));
      return;
    }

    const callbackState = url.searchParams.get("state");
    const code = url.searchParams.get("code");

    if (callbackState !== state) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(_oauthHtml("OAuth state mismatch."));
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(_oauthHtml("Missing authorization code."));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(_oauthHtml("OpenAI authentication completed. You can close this window."));

    resolveCode(code);
  });

  return new Promise((resolve, reject) => {
    server.listen(OPENAI_CODEX_CALLBACK_PORT, "127.0.0.1", () => {
      resolve({
        server,
        waitForCode: () => codePromise,
        close: () => {
          server.close();
          resolveCode(null);
        },
      });
    });

    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        // Port already in use - can't start local server
        resolve({
          server,
          waitForCode: () => Promise.resolve(null),
          close: () => {},
        });
      } else {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Login Flow
// ---------------------------------------------------------------------------

export interface LoginOptions {
  openBrowser?: boolean;
  onAuth?: (info: OAuthAuthInfo) => void;
  onProgress?: (message: string) => void;
}

export async function loginOpenAICodex(
  options: LoginOptions = {},
): Promise<OAuthCredential> {
  const { openBrowser = true, onAuth, onProgress } = options;

  const flow = createOpenAICodexAuthorizationFlow();
  const server = await startLocalOAuthServer(flow.state);

  if (!server) {
    throw new OAuthError("Could not start local OAuth server");
  }

  onAuth?.({
    url: flow.url,
    instructions: "A browser window should open. Complete login to finish.",
  });

  if (openBrowser) {
    // Try to open browser
    try {
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
          ? "start"
          : "xdg-open";
      spawn(opener, [flow.url], { detached: true, stdio: "ignore" });
    } catch {
      // Browser open failed - user will need to manually visit URL
    }
  }

  try {
    onProgress?.("Waiting for authorization...");
    const code = await server.waitForCode();

    if (!code) {
      throw new OAuthError(
        "Local callback server unavailable. Please manually paste the authorization code.",
      );
    }

    onProgress?.("Exchanging authorization code...");
    const token = await exchangeOpenAICodexAuthorizationCode(code, flow.verifier);
    const accountId = accountIdFromAccessToken(token.accessToken);

    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      accountId,
    };
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _oauthHtml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><meta charset="utf-8"><title>Alpha OAuth</title><p>${escaped}</p>`;
}
