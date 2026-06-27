import { z } from "zod/v4";
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Provider config schemas
// ---------------------------------------------------------------------------

export const OpenAICompatibleProviderConfigSchema = z.strictObject({
  kind: z.literal("openai_compatible"),
  name: z.string(),
  baseUrl: z.string(),
  apiKeyEnv: z.string().optional(),
  credentialName: z.string().optional(),
  models: z.array(z.string()),
  defaultModel: z.string(),
  contextWindows: z.record(z.string(), z.number()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: z.number().optional(),
  maxRetries: z.number().optional(),
  maxRetryDelaySeconds: z.number().optional(),
  thinkingLevels: z.array(z.string()).optional(),
  thinkingModels: z.array(z.string()).optional(),
  thinkingParameter: z.string().optional(),
});

export type OpenAICompatibleProviderConfig = z.infer<typeof OpenAICompatibleProviderConfigSchema>;

export const AnthropicProviderConfigSchema = z.strictObject({
  kind: z.literal("anthropic"),
  name: z.string(),
  baseUrl: z.string(),
  apiKeyEnv: z.string().optional(),
  credentialName: z.string().optional(),
  models: z.array(z.string()),
  defaultModel: z.string(),
  contextWindows: z.record(z.string(), z.number()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: z.number().optional(),
  maxRetries: z.number().optional(),
  maxRetryDelaySeconds: z.number().optional(),
  thinkingLevels: z.array(z.string()).optional(),
  thinkingModels: z.array(z.string()).optional(),
  thinkingBudgetTokens: z.number().optional(),
});

export type AnthropicProviderConfig = z.infer<typeof AnthropicProviderConfigSchema>;

export const OpenAICodexProviderConfigSchema = z.strictObject({
  kind: z.literal("openai_codex"),
  name: z.string(),
  baseUrl: z.string(),
  credentialName: z.string(),
  models: z.array(z.string()),
  defaultModel: z.string(),
  contextWindows: z.record(z.string(), z.number()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: z.number().optional(),
  maxRetries: z.number().optional(),
  maxRetryDelaySeconds: z.number().optional(),
  thinkingLevels: z.array(z.string()).optional(),
  thinkingModels: z.array(z.string()).optional(),
  thinkingParameter: z.string().optional(),
});

export type OpenAICodexProviderConfig = z.infer<typeof OpenAICodexProviderConfigSchema>;

export const ProviderConfigSchema = z.discriminatedUnion("kind", [
  OpenAICompatibleProviderConfigSchema,
  AnthropicProviderConfigSchema,
  OpenAICodexProviderConfigSchema,
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ---------------------------------------------------------------------------
// ProviderSettings
// ---------------------------------------------------------------------------

export const ProviderSettingsSchema = z.strictObject({
  defaultProvider: z.string(),
  providers: z.array(ProviderConfigSchema),
  scopedModels: z.array(
    z.strictObject({ provider: z.string(), model: z.string() }),
  ).default([]),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

// ---------------------------------------------------------------------------
// Built-in provider catalog
// ---------------------------------------------------------------------------

export const builtinProviderCatalog: ProviderConfig[] = [
  {
    kind: "openai_compatible",
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-5.5", "gpt-5.5-mini", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-5.5",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    thinkingModels: ["gpt-5.5", "gpt-5"],
  },
  {
    kind: "anthropic",
    name: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-6"],
    defaultModel: "claude-sonnet-4-6",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    thinkingModels: ["claude-sonnet-4-6", "claude-opus-4-6"],
  },
  {
    kind: "openai_compatible",
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    models: ["openai/gpt-5.5", "openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro"],
    defaultModel: "openai/gpt-5.5",
  },
];

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function loadProviderSettings(filePath?: string): ProviderSettings {
  const path = filePath ?? join(tmpdir(), "alpha-providers.json");

  let parsed: unknown;
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      parsed = {};
    }
  }

  const userSettings = ProviderSettingsSchema.partial().safeParse(parsed ?? {});
  const userProviders = (userSettings.success ? userSettings.data.providers : []) ?? [];
  const userNames = new Set(userProviders.map((p) => p.name));

  // Merge: built-in providers not overridden by user config are kept
  const mergedProviders = [
    ...userProviders,
    ...builtinProviderCatalog.filter((p) => !userNames.has(p.name)),
  ];

  const defaultProvider = (userSettings.success ? userSettings.data.defaultProvider : undefined)
    ?? builtinProviderCatalog[0]?.name
    ?? "openai";

  const scopedModels = userSettings.success ? (userSettings.data.scopedModels ?? []) : [];

  return { defaultProvider, providers: mergedProviders, scopedModels };
}

export function saveProviderSettings(settings: ProviderSettings, filePath: string): void {
  const tempPath = join(tmpdir(), `alpha-providers-${randomUUID()}.json`);
  writeFileSync(tempPath, JSON.stringify(settings, null, 2), { mode: 0o644 });
  try {
    renameSync(tempPath, filePath);
  } catch {
    unlinkSync(tempPath);
    throw new Error("Failed to write provider settings");
  }
}

// ---------------------------------------------------------------------------
// upsertProvider — merge or add a provider config
// ---------------------------------------------------------------------------

export function upsertProvider(settings: ProviderSettings, config: ProviderConfig): ProviderSettings {
  const existing = settings.providers.findIndex((p) => p.name === config.name);
  const newProviders = [...settings.providers];
  if (existing >= 0) {
    newProviders[existing] = config;
  } else {
    newProviders.push(config);
  }
  return { ...settings, providers: newProviders };
}

// ---------------------------------------------------------------------------
// resolveProviderSelection — resolve provider + model from settings
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  config: ProviderConfig;
  model: string;
}

export function resolveProviderSelection(
  settings: ProviderSettings,
  providerName?: string,
  model?: string,
): ResolvedProvider | null {
  const name = providerName ?? settings.defaultProvider;
  const config = settings.providers.find((p) => p.name === name);
  if (!config) return null;

  const resolvedModel = model ?? config.defaultModel;
  // Validate model exists
  if (!config.models.includes(resolvedModel)) {
    // Fall back to default
    return { config, model: config.defaultModel };
  }

  return { config, model: resolvedModel };
}
