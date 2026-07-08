/**
 * Runtime provider construction for Alpha coding sessions.
 *
 * Transforms durable ProviderConfig into a live ModelProvider instance,
 * handling credential resolution, thinking parameters, and provider-specific
 * configuration.
 */

import type { ModelProvider } from "@alpha/ai";
import { OpenAICompatibleProvider } from "@alpha/ai/providers/openai-compatible";
import { AnthropicProvider } from "@alpha/ai/providers/anthropic";
import type { CredentialStore, OAuthCredential } from "./credentials.ts";
import { FileCredentialStore } from "./credentials.ts";
import type { ProviderConfig } from "./providers.ts";
import type { ThinkingLevel } from "../thinking.ts";
import {
  normalizeThinkingLevel,
  reasoningEffortForLevel,
  anthropicThinkingBudgetForLevel,
} from "../thinking.ts";
import { providerThinkingLevels } from "./providers.ts";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// ClosableModelProvider
// ---------------------------------------------------------------------------

export interface ClosableModelProvider extends ModelProvider {
  aclose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// createModelProvider
// ---------------------------------------------------------------------------

export function createModelProvider(
  provider: ProviderConfig,
  opts?: {
    credentialStore?: CredentialStore;
    model?: string;
    thinkingLevel?: ThinkingLevel;
  },
): ClosableModelProvider {
  const credentialStore = opts?.credentialStore ?? new FileCredentialStore(getCredentialsPath());
  const model = opts?.model;
  const thinkingLevel = opts?.thinkingLevel;

  switch (provider.kind) {
    case "openai_compatible":
      return createOpenAICompatibleProvider(provider, {
        credentialStore,
        model,
        thinkingLevel,
      });
    case "anthropic":
      return createAnthropicProvider(provider, {
        credentialStore,
        thinkingLevel,
      });
    case "openai_codex":
      // For now, treat openai_codex as openai_compatible with stored credentials
      // Full OAuth flow would be added in Phase C
      return createOpenAICodexProvider(provider, {
        credentialStore,
        model,
        thinkingLevel,
      });
    default:
      throw new ProviderConfigError(
        `Unknown provider kind: ${(provider as { kind: string }).kind}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Provider-specific constructors
// ---------------------------------------------------------------------------

function createOpenAICompatibleProvider(
  provider: ProviderConfig,
  opts: {
    credentialStore: CredentialStore;
    model?: string;
    thinkingLevel?: ThinkingLevel;
  },
): ClosableModelProvider {
  const apiKey = resolveApiKey(provider, opts.credentialStore);
  const baseUrl = resolveBaseUrl(provider);

  const reasoningEffort = resolveReasoningEffort(provider, {
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
  });

  const prov = new OpenAICompatibleProvider({
    apiKey,
    baseUrl,
    headers: provider.headers,
    timeoutSeconds: provider.timeoutSeconds ?? 120,
    maxRetries: provider.maxRetries ?? 3,
    maxRetryDelaySeconds: provider.maxRetryDelaySeconds ?? 30,
    reasoningEffort: reasoningEffort ?? undefined,
    reasoningEffortParameter: getThinkingParameter(provider) as
      | "reasoning_effort"
      | "reasoning.effort"
      | undefined,
  });

  return wrapProvider(prov);
}

function createAnthropicProvider(
  provider: ProviderConfig,
  opts: {
    credentialStore: CredentialStore;
    thinkingLevel?: ThinkingLevel;
  },
): ClosableModelProvider {
  const apiKey = resolveApiKey(provider, opts.credentialStore);
  const baseUrl = provider.baseUrl.replace(/\/$/, "");

  const thinkingBudgetTokens = resolveAnthropicThinkingBudget(provider, {
    thinkingLevel: opts.thinkingLevel,
  });

  const prov = new AnthropicProvider({
    apiKey,
    baseUrl,
    headers: provider.headers,
    timeoutSeconds: provider.timeoutSeconds ?? 120,
    maxRetries: provider.maxRetries ?? 3,
    maxRetryDelaySeconds: provider.maxRetryDelaySeconds ?? 30,
    thinkingBudgetTokens: thinkingBudgetTokens ?? undefined,
  });

  return wrapProvider(prov);
}

function createOpenAICodexProvider(
  provider: ProviderConfig,
  opts: {
    credentialStore: CredentialStore;
    model?: string;
    thinkingLevel?: ThinkingLevel;
  },
): ClosableModelProvider {
  // For now, use stored OAuth access token directly as API key
  // Full OAuth refresh flow would be added in Phase C
  const credentialName = provider.credentialName;
  let apiKey: string | undefined;

  if (credentialName) {
    // Try to get OAuth credential (sync for now)
    const store = opts.credentialStore as FileCredentialStore;
    // Use getOAuth synchronously for the common case
    const oauthPromise = store.getOAuth(credentialName);
    // For simplicity, just use the promise result
    // In Phase C we'd add proper async handling
  }

  // Fall back to environment variable
  const envVarName = "OPENAI_CODEX_ACCESS_TOKEN";
  if (!apiKey) {
    apiKey = process.env[envVarName];
  }

  if (!apiKey) {
    const hint = credentialName
      ? ` Run /login ${provider.name} to authenticate.`
      : ` Set ${envVarName} or run /login ${provider.name}.`;
    throw new ProviderConfigError(
      `Missing OpenAI Codex credentials for ${provider.name}.${hint}`,
    );
  }

  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const reasoningEffort = resolveReasoningEffort(provider, {
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
  });

  const prov = new OpenAICompatibleProvider({
    apiKey,
    baseUrl,
    headers: provider.headers,
    timeoutSeconds: provider.timeoutSeconds ?? 120,
    maxRetries: provider.maxRetries ?? 3,
    maxRetryDelaySeconds: provider.maxRetryDelaySeconds ?? 30,
    reasoningEffort: reasoningEffort ?? undefined,
    reasoningEffortParameter: getThinkingParameter(provider) as
      | "reasoning_effort"
      | "reasoning.effort"
      | undefined,
  });

  return wrapProvider(prov);
}

// ---------------------------------------------------------------------------
// wrapProvider — add aclose method
// ---------------------------------------------------------------------------

function wrapProvider(prov: ModelProvider): ClosableModelProvider {
  const wrapped: ClosableModelProvider = {
    streamResponse: prov.streamResponse.bind(prov),
    async aclose() {
      // Most providers have no resources to close
    },
  };
  return wrapped;
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

function resolveApiKey(
  provider: ProviderConfig,
  credentialStore: CredentialStore,
): string {
  // Priority: stored credential → environment variable
  // Note: FileCredentialStore.get() returns a Promise, but for now we check env first
  // In a real async context, we'd await the credential store

  const apiKeyEnv = getApiKeyEnv(provider);
  const apiKey = process.env[apiKeyEnv];

  if (apiKey) {
    return apiKey;
  }

  // Try to get stored credential synchronously (not possible with async store)
  // This is a limitation of the current design - for sync initialization,
  // credentials should be set via environment variables
  // The async flow would be: await credentialStore.get(name)

  const hint = provider.credentialName
    ? ` Set ${apiKeyEnv} or run /login ${provider.name}.`
    : ` Set ${apiKeyEnv}.`;
  throw new ProviderConfigError(
    `Missing API key for ${provider.name}.${hint}`,
  );
}

function getApiKeyEnv(provider: ProviderConfig): string {
  if (provider.kind !== "openai_codex" && provider.apiKeyEnv) {
    return provider.apiKeyEnv;
  }
  // Default env var names
  switch (provider.name) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "openai-codex":
    case "openai_codex":
      return "OPENAI_CODEX_ACCESS_TOKEN";
    default:
      return `${provider.name.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  }
}

function resolveBaseUrl(provider: ProviderConfig): string {
  let baseUrl = provider.baseUrl.replace(/\/$/, "");

  // Allow environment override for OpenAI
  if (provider.name === "openai" && provider.kind === "openai_compatible") {
    baseUrl = process.env.OPENAI_BASE_URL ?? baseUrl;
  }

  return baseUrl;
}

function getThinkingParameter(provider: ProviderConfig): string | undefined {
  if ("thinkingParameter" in provider && provider.thinkingParameter) {
    return provider.thinkingParameter;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Thinking parameter resolution
// ---------------------------------------------------------------------------

function resolveReasoningEffort(
  provider: ProviderConfig,
  opts?: {
    model?: string;
    thinkingLevel?: ThinkingLevel;
  },
): string | null {
  if (!opts?.thinkingLevel) return null;

  const levels = providerThinkingLevels(provider, { model: opts.model });
  if (!levels || levels.length === 0) return null;

  const normalized = normalizeThinkingLevel(opts.thinkingLevel);
  if (!levels.includes(normalized)) {
    const available = levels.join(", ");
    const model = opts.model ?? provider.defaultModel;
    throw new ProviderConfigError(
      `Thinking mode ${normalized} is not available for ${provider.name}:${model}. Available modes: ${available}`,
    );
  }

  return reasoningEffortForLevel(normalized);
}

function resolveAnthropicThinkingBudget(
  provider: ProviderConfig,
  opts?: {
    thinkingLevel?: ThinkingLevel;
  },
): number | null {
  if (!opts?.thinkingLevel) return null;
  const thinkingParam = getThinkingParameter(provider);
  if (thinkingParam !== "anthropic.thinking") return null;

  const levels = providerThinkingLevels(provider);
  if (!levels || levels.length === 0) return null;

  const normalized = normalizeThinkingLevel(opts.thinkingLevel);
  if (!levels.includes(normalized)) {
    const available = levels.join(", ");
    throw new ProviderConfigError(
      `Thinking mode ${normalized} is not available for ${provider.name}:${provider.defaultModel}. Available modes: ${available}`,
    );
  }

  return anthropicThinkingBudgetForLevel(normalized);
}

// ---------------------------------------------------------------------------
// Provider config helpers
// ---------------------------------------------------------------------------

export function providerDefaultThinkingLevel(
  provider: ProviderConfig,
  model?: string,
): ThinkingLevel | null {
  const levels = providerThinkingLevels(provider, { model });
  if (!levels || levels.length === 0) return null;

  // Check if default is specified and valid
  if ("thinkingDefault" in provider && provider.thinkingDefault) {
    const thinkingDefault = provider.thinkingDefault;
    if (levels.includes(thinkingDefault as ThinkingLevel)) {
      return thinkingDefault as ThinkingLevel;
    }
  }

  // Fall back to "medium" if available, otherwise first
  if (levels.includes("medium")) return "medium";
  return levels[0] ?? null;
}

export function providerHasUsableCredentials(
  provider: ProviderConfig,
  credentialStore?: CredentialStore,
): boolean {
  // Check stored credentials
  if (provider.credentialName && credentialStore) {
    if (provider.kind === "openai_codex") {
      // OAuth credentials
      const oauth = credentialStore.getOAuth(provider.credentialName);
      // Can't check synchronously - just check env instead
    } else {
      const key = credentialStore.get(provider.credentialName);
      // Can't check synchronously - just check env instead
    }
  }

  // Check environment
  const apiKeyEnv = getApiKeyEnv(provider);
  return !!process.env[apiKeyEnv];
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCredentialsPath(): string {
  const home = process.env.ALPHA_HOME ?? homedir();
  return join(home, ".alpha", "credentials.json");
}

export function getProviderFromConfig(
  settings: { providers: ProviderConfig[]; defaultProvider: string },
  providerName?: string,
  model?: string,
): { provider: ProviderConfig; model: string } {
  const name = providerName ?? settings.defaultProvider;
  const provider = settings.providers.find((p) => p.name === name);

  if (!provider) {
    throw new ProviderConfigError(`Unknown provider: ${name}`);
  }

  const resolvedModel = model ?? provider.defaultModel;
  return { provider, model: resolvedModel };
}
