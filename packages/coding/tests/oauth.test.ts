import { describe, test, expect } from "bun:test";
import {
  createPKCEPair,
  createOpenAICodexAuthorizationFlow,
  accountIdFromAccessToken,
  oauthCredentialIsExpired,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_AUTHORIZE_URL,
  OPENAI_CODEX_REDIRECT_URI,
} from "../src/oauth.ts";

// ---------------------------------------------------------------------------
// PKCE Tests
// ---------------------------------------------------------------------------

describe("createPKCEPair", () => {
  test("creates verifier and challenge", () => {
    const { verifier, challenge } = createPKCEPair();

    expect(verifier).toBeDefined();
    expect(challenge).toBeDefined();
    expect(verifier.length).toBeGreaterThan(0);
    expect(challenge.length).toBeGreaterThan(0);
    expect(verifier).not.toBe(challenge);
  });

  test("creates unique pairs", () => {
    const pair1 = createPKCEPair();
    const pair2 = createPKCEPair();

    expect(pair1.verifier).not.toBe(pair2.verifier);
    expect(pair1.challenge).not.toBe(pair2.challenge);
  });

  test("verifier is base64url encoded", () => {
    const { verifier } = createPKCEPair();
    // Base64url: A-Za-z0-9_- only
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// ---------------------------------------------------------------------------
// Authorization Flow Tests
// ---------------------------------------------------------------------------

describe("createOpenAICodexAuthorizationFlow", () => {
  test("creates valid authorization flow", () => {
    const flow = createOpenAICodexAuthorizationFlow();

    expect(flow.verifier).toBeDefined();
    expect(flow.state).toBeDefined();
    expect(flow.url).toBeDefined();
  });

  test("includes correct parameters in URL", () => {
    const flow = createOpenAICodexAuthorizationFlow();
    const url = new URL(flow.url);

    // Origin should be the auth endpoint domain
    expect(url.host).toBe("auth.openai.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(OPENAI_CODEX_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(OPENAI_CODEX_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("includes state and challenge", () => {
    const flow = createOpenAICodexAuthorizationFlow();
    const url = new URL(flow.url);

    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("code_challenge")).toBeDefined();
  });

  test("supports custom originator", () => {
    const flow = createOpenAICodexAuthorizationFlow("my-app");
    const url = new URL(flow.url);

    expect(url.searchParams.get("originator")).toBe("my-app");
  });

  test("creates unique state for each flow", () => {
    const flow1 = createOpenAICodexAuthorizationFlow();
    const flow2 = createOpenAICodexAuthorizationFlow();

    expect(flow1.state).not.toBe(flow2.state);
  });
});

// ---------------------------------------------------------------------------
// Token Utilities Tests
// ---------------------------------------------------------------------------

describe("accountIdFromAccessToken", () => {
  test("returns undefined for invalid token", () => {
    expect(accountIdFromAccessToken("")).toBeUndefined();
    expect(accountIdFromAccessToken("invalid")).toBeUndefined();
    expect(accountIdFromAccessToken("a.b")).toBeUndefined();
  });

  test("returns undefined for token without account claim", () => {
    // Create a fake JWT payload without the account claim
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user123" })).toString("base64url");
    const signature = "signature";

    const token = `${header}.${payload}.${signature}`;
    expect(accountIdFromAccessToken(token)).toBeUndefined();
  });

  test("extracts account ID from valid token", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user123",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account-abc-123",
        },
      }),
    ).toString("base64url");
    const signature = "signature";

    const token = `${header}.${payload}.${signature}`;
    expect(accountIdFromAccessToken(token)).toBe("account-abc-123");
  });
});

describe("oauthCredentialIsExpired", () => {
  test("returns true for expired credential", () => {
    const credential = {
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1000, // 1 second ago
    };

    expect(oauthCredentialIsExpired(credential)).toBe(true);
  });

  test("returns false for valid credential", () => {
    const credential = {
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600000, // 1 hour from now
    };

    expect(oauthCredentialIsExpired(credential)).toBe(false);
  });

  test("accounts for refresh skew", () => {
    const credential = {
      accessToken: "token",
      refreshToken: "refresh",
      // Will expire in 30 seconds - within skew
      expiresAt: Date.now() + 30000,
    };

    expect(oauthCredentialIsExpired(credential)).toBe(true);
  });
});
