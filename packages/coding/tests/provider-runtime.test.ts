import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createModelProvider,
  providerHasUsableCredentials,
  ProviderConfigError,
  providerDefaultThinkingLevel,
} from "../src/config/provider-runtime.ts";
import {
  loadProviderSettings,
  type ProviderConfig,
} from "../src/config/providers.ts";
import { FileCredentialStore } from "../src/config/credentials.ts";
import { FakeProvider } from "@alpha/ai";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let credentialStore: FileCredentialStore;

beforeEach(() => {
  tempDir = join(tmpdir(), `alpha-provider-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  credentialStore = new FileCredentialStore(join(tempDir, "credentials.json"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createModelProvider", () => {
  test("creates OpenAI-compatible provider with API key from environment", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    try {
      const provider: ProviderConfig = {
        kind: "openai_compatible",
        name: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4"],
        defaultModel: "gpt-4",
      };

      const modelProvider = createModelProvider(provider, { credentialStore });
      expect(modelProvider).toBeDefined();
      expect(modelProvider.streamResponse).toBeDefined();
      expect(typeof modelProvider.aclose).toBe("function");

      await modelProvider.aclose();
    } finally {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test("creates Anthropic provider with API key from environment", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";

    try {
      const provider: ProviderConfig = {
        kind: "anthropic",
        name: "anthropic",
        baseUrl: "https://api.anthropic.com",
        models: ["claude-3-sonnet"],
        defaultModel: "claude-3-sonnet",
      };

      const modelProvider = createModelProvider(provider, { credentialStore });
      expect(modelProvider).toBeDefined();
      expect(modelProvider.streamResponse).toBeDefined();

      await modelProvider.aclose();
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  test("throws ProviderConfigError when missing API key", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const provider: ProviderConfig = {
        kind: "openai_compatible",
        name: "test-provider",
        baseUrl: "https://example.com/v1",
        models: ["test-model"],
        defaultModel: "test-model",
      };

      expect(() => createModelProvider(provider, { credentialStore })).toThrow(
        ProviderConfigError,
      );
    } finally {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test("throws when relying on stored credential (sync limitation)", () => {
    // Note: In the current implementation, we can't use stored credentials synchronously
    // They require async initialization. This test documents that limitation.
    const provider: ProviderConfig = {
      kind: "openai_compatible",
      name: "stored-provider",
      baseUrl: "https://api.example.com/v1",
      models: ["model-1"],
      defaultModel: "model-1",
      credentialName: "stored-api-key",
    };

    // Without env var, it should throw even with credentialName set
    expect(() => createModelProvider(provider, { credentialStore })).toThrow(
      ProviderConfigError,
    );
  });
});

describe("providerHasUsableCredentials", () => {
  test("returns true when environment variable is set", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    try {
      const provider: ProviderConfig = {
        kind: "openai_compatible",
        name: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4"],
        defaultModel: "gpt-4",
        apiKeyEnv: "OPENAI_API_KEY",
      };

      expect(providerHasUsableCredentials(provider, credentialStore)).toBe(true);
    } finally {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test("returns false when no credentials available", () => {
    const originalKey = process.env.CUSTOM_API_KEY;
    delete process.env.CUSTOM_API_KEY;

    try {
      const provider: ProviderConfig = {
        kind: "openai_compatible",
        name: "custom",
        baseUrl: "https://api.custom.com/v1",
        models: ["model-1"],
        defaultModel: "model-1",
        apiKeyEnv: "CUSTOM_API_KEY",
      };

      expect(providerHasUsableCredentials(provider, credentialStore)).toBe(false);
    } finally {
      process.env.CUSTOM_API_KEY = originalKey;
    }
  });
});

describe("providerDefaultThinkingLevel", () => {
  test("returns null when no thinking levels defined", () => {
    const provider: ProviderConfig = {
      kind: "openai_compatible",
      name: "test",
      baseUrl: "https://api.example.com/v1",
      models: ["model-1"],
      defaultModel: "model-1",
    };

    expect(providerDefaultThinkingLevel(provider)).toBeNull();
  });

  test("returns medium when available", () => {
    const provider: ProviderConfig = {
      kind: "openai_compatible",
      name: "test",
      baseUrl: "https://api.example.com/v1",
      models: ["model-1"],
      defaultModel: "model-1",
      thinkingLevels: ["off", "low", "medium", "high"],
    };

    expect(providerDefaultThinkingLevel(provider)).toBe("medium");
  });

  test("returns first level when medium not available", () => {
    const provider: ProviderConfig = {
      kind: "openai_compatible",
      name: "test",
      baseUrl: "https://api.example.com/v1",
      models: ["model-1"],
      defaultModel: "model-1",
      thinkingLevels: ["off", "low", "high"],
    };

    expect(providerDefaultThinkingLevel(provider)).toBe("off");
  });

  test("returns null when model not in thinkingModels", () => {
    const provider: ProviderConfig = {
      kind: "openai_compatible",
      name: "test",
      baseUrl: "https://api.example.com/v1",
      models: ["model-1", "model-2"],
      defaultModel: "model-1",
      thinkingLevels: ["off", "medium"],
      thinkingModels: ["model-2"],
    };

    expect(providerDefaultThinkingLevel(provider, "model-1")).toBeNull();
    expect(providerDefaultThinkingLevel(provider, "model-2")).toBe("medium");
  });
});

describe("ProviderConfigError", () => {
  test("has correct name and message", () => {
    const error = new ProviderConfigError("Test error message");
    expect(error.name).toBe("ProviderConfigError");
    expect(error.message).toBe("Test error message");
    expect(error instanceof Error).toBe(true);
  });
});
