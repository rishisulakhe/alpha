/**
 * Provider factory for Alpha coding sessions.
 *
 * Creates ModelProvider instances from configuration, with fallback to
 * environment variables when no explicit config is provided.
 */

import type { ModelProvider, ProviderEvent } from "@alpha/ai";
import { OpenAICompatibleProvider } from "@alpha/ai/providers/openai-compatible";
import { AnthropicProvider } from "@alpha/ai/providers/anthropic";
import { getAlphaPaths, ensureAlphaDirectories } from "./config/paths.ts";
import {
  loadProviderSettings,
  resolveProviderSelection,
  type ProviderSettings,
  type ProviderConfig,
} from "./config/providers.ts";
import {
  createModelProvider,
  providerHasUsableCredentials,
  type ClosableModelProvider,
} from "./config/provider-runtime.ts";
import { FileCredentialStore } from "./config/credentials.ts";
import type { ThinkingLevel } from "./thinking.ts";

// ---------------------------------------------------------------------------
// echoProvider — always returns a fixed mock response (demo mode)
// ---------------------------------------------------------------------------

export function echoProvider(model?: string): ModelProvider {
  const name = model ?? "echo";
  return {
    async *streamResponse(): AsyncIterable<ProviderEvent> {
      yield { type: "response_start", model: name } satisfies ProviderEvent;
      yield {
        type: "text_delta",
        text: "Hello! I'm a demo response. Set OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to use a real LLM.",
      } satisfies ProviderEvent;
      yield {
        type: "response_end",
        message: {
          role: "assistant",
          content: "Hello! I'm a demo response. Set OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to use a real LLM.",
          tool_calls: [],
        },
        finishReason: "stop",
      } satisfies ProviderEvent;
    },
  };
}

// ---------------------------------------------------------------------------
// ProviderConfig type for createProvider options
// ---------------------------------------------------------------------------

export interface ProviderOptions {
  providerName?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  apiKey?: string;
  baseUrl?: string;
  // When true, use environment-only mode (no saved config)
  envOnly?: boolean;
}

// ---------------------------------------------------------------------------
// createProvider — create a configured provider
// ---------------------------------------------------------------------------

export function createProvider(opts?: ProviderOptions): ModelProvider {
  ensureAlphaDirectories();
  const paths = getAlphaPaths();

  // If envOnly mode or explicit API key provided, use environment-only config
  if (opts?.envOnly || opts?.apiKey) {
    return createProviderFromEnv(opts);
  }

  // Load full provider configuration
  const settings = loadProviderSettings(paths.providersFile);
  const credentialStore = new FileCredentialStore(paths.credentialsFile);

  // If a specific provider is requested, use it
  if (opts?.providerName) {
    try {
      const { config, model } = resolveProviderSelection(settings, opts.providerName, opts.model) ?? {};
      if (!config) {
        // Provider not found in config — check if it's a built-in with env credentials
        return createProviderFromEnv(opts);
      }

      // Check credentials
      if (!providerHasUsableCredentials(config, credentialStore)) {
        const apiKeyEnv = config.kind !== "openai_codex" && "apiKeyEnv" in config
          ? config.apiKeyEnv
          : `${config.name.toUpperCase().replace(/-/g, "_")}_API_KEY`;
        throw new Error(
          `Provider ${config.name} has no usable credentials. Set ${apiKeyEnv ?? "an API key"} or run /login ${config.name}.`,
        );
      }

      return createModelProvider(config, {
        credentialStore,
        model,
        thinkingLevel: opts.thinkingLevel,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[alpha] Provider error: ${msg}\n`);
      throw err;
    }
  }

  // Auto-select — find first provider with usable credentials
  const selection = findFirstUsableProvider(settings, credentialStore);
  if (selection) {
    const { config, model } = selection;
    process.stderr.write(`[alpha] Using ${config.name}:${model}\n`);
    return createModelProvider(config, {
      credentialStore,
      model,
      thinkingLevel: opts?.thinkingLevel,
    });
  }

  // No credentials found, use demo mode
  process.stderr.write(
    "[alpha] No API key found. Using demo mode. Set OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for a real LLM.\n",
  );
  return echoProvider(opts?.model);
}

// ---------------------------------------------------------------------------
// createProviderFromEnv — create provider using only environment variables
// ---------------------------------------------------------------------------

function createProviderFromEnv(opts?: ProviderOptions): ModelProvider {
  // Direct API key provided
  if (opts?.apiKey) {
    const model = opts.model ?? process.env.ALPHA_MODEL ?? "gpt-4o";
    const baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    process.stderr.write(`[alpha] Using custom provider with model=${model}\n`);
    return new OpenAICompatibleProvider({
      apiKey: opts.apiKey,
      baseUrl,
      maxRetries: 2,
      maxRetryDelaySeconds: 30,
      timeoutSeconds: 120,
    });
  }

  // OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    const model = process.env.ALPHA_MODEL ?? "openai/gpt-4o";
    process.stderr.write(`[alpha] Using OpenRouter with model=${model}\n`);
    return new OpenAICompatibleProvider({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: opts?.baseUrl ?? "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://alpha.dev",
        "X-Title": "Alpha Coding Agent",
      },
      maxRetries: 2,
      maxRetryDelaySeconds: 30,
      timeoutSeconds: 120,
    });
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.ALPHA_MODEL ?? "gpt-4.1";
    const baseUrl = process.env.OPENAI_BASE_URL ?? opts?.baseUrl ?? "https://api.openai.com/v1";
    process.stderr.write(`[alpha] Using OpenAI with model=${model}\n`);
    return new OpenAICompatibleProvider({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl,
      maxRetries: 2,
      maxRetryDelaySeconds: 30,
      timeoutSeconds: 120,
    });
  }

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ALPHA_MODEL ?? "claude-sonnet-4-6";
    const baseUrl = opts?.baseUrl ?? "https://api.anthropic.com";
    process.stderr.write(`[alpha] Using Anthropic with model=${model}\n`);
    return new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl,
      maxRetries: 2,
      maxRetryDelaySeconds: 30,
      timeoutSeconds: 120,
    });
  }

  // Demo mode
  process.stderr.write(
    "[alpha] No API key found. Using demo mode. Set OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.\n",
  );
  return echoProvider(opts?.model);
}

// ---------------------------------------------------------------------------
// findFirstUsableProvider — find the first provider with credentials
// ---------------------------------------------------------------------------

function findFirstUsableProvider(
  settings: ProviderSettings,
  credentialStore: FileCredentialStore,
): { config: ProviderConfig; model: string } | null {
  const defaultProvider = settings.providers.find(
    (p) => p.name === settings.defaultProvider,
  );

  // Check default provider first
  if (defaultProvider && providerHasUsableCredentials(defaultProvider, credentialStore)) {
    return { config: defaultProvider, model: defaultProvider.defaultModel };
  }

  // Check all providers
  for (const config of settings.providers) {
    if (providerHasUsableCredentials(config, credentialStore)) {
      return { config, model: config.defaultModel };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// re-export types
// ---------------------------------------------------------------------------

export type { ClosableModelProvider };
export { createModelProvider, providerHasUsableCredentials } from "./config/provider-runtime.ts";
export { loadProviderSettings, saveProviderSettings } from "./config/providers.ts";
export { FileCredentialStore } from "./config/credentials.ts";
export { getAlphaPaths, ensureAlphaDirectories } from "./config/paths.ts";
