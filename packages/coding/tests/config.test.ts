import { describe, expect, test } from "bun:test";
import { getAlphaPaths, projectHash, projectSlug, projectSessionDir, defaultSessionPath } from "../src/config/paths.ts";
import { FileCredentialStore, type OAuthCredential } from "../src/config/credentials.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// === Step 28: Paths ===

describe("AlphaPaths", () => {
  test("home is ~/.alpha", () => {
    const paths = getAlphaPaths();
    expect(paths.home).toContain(".alpha");
    expect(paths.home.startsWith(os.homedir())).toBe(true);
  });

  test("sessionsDir is under .alpha/sessions", () => {
    const paths = getAlphaPaths();
    expect(paths.sessionsDir).toContain(".alpha/sessions");
  });

  test("providersFile and credentialsFile exist", () => {
    const paths = getAlphaPaths();
    expect(paths.providersFile).toContain("providers.json");
    expect(paths.credentialsFile).toContain("credentials.json");
  });

  test("userSkillsDir and userPromptsDir" , () => {
    const paths = getAlphaPaths();
    expect(paths.userSkillsDir).toContain("skills");
    expect(paths.userPromptsDir).toContain("prompts");
  });
});

describe("projectHash", () => {
  test("returns 6-char hex string", () => {
    const hash = projectHash("/home/user/project");
    expect(hash.length).toBe(6);
    expect(/^[0-9a-f]{6}$/.test(hash)).toBe(true);
  });

  test("is deterministic", () => {
    expect(projectHash("/home/user/project")).toBe(projectHash("/home/user/project"));
  });

  test("different paths produce different hashes", () => {
    expect(projectHash("/home/a")).not.toBe(projectHash("/home/b"));
  });
});

describe("projectSlug", () => {
  test("slugifies a Unix path", () => {
    const slug = projectSlug("/home/user/my-project");
    expect(slug).toBe("home-user-my-project");
  });

  test("replaces special chars with underscores", () => {
    const slug = projectSlug("/Users/name/projects/my cool-repo!");
    expect(slug).toContain("my_cool-repo");
  });
});

describe("projectSessionDir", () => {
  test("combines slug and hash", () => {
    const dir = projectSessionDir("/home/user/project");
    expect(dir).toContain(".alpha/sessions/");
    expect(dir).toContain("home-user-project");
    const hash = projectHash("/home/user/project");
    expect(dir.endsWith(`-${hash}`)).toBe(true);
  });
});

describe("defaultSessionPath", () => {
  test("returns default.jsonl inside project session dir", () => {
    const sessionPath = defaultSessionPath("/home/user/project");
    expect(sessionPath.endsWith("default.jsonl")).toBe(true);
  });
});

// === Step 29: Credential Store ===

describe("FileCredentialStore", () => {
  test("set and get API key", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-creds-"));
    const filePath = path.join(tmpDir, "creds.json");
    try {
      const store = new FileCredentialStore(filePath);
      await store.set("openai", "sk-test123");
      const val = await store.get("openai");
      expect(val).toBe("sk-test123");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("get returns undefined for nonexistent key", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-creds-missing-"));
    const filePath = path.join(tmpDir, "creds.json");
    try {
      const store = new FileCredentialStore(filePath);
      expect(await store.get("nonexistent")).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles missing file gracefully", async () => {
    const store = new FileCredentialStore("/tmp/nonexistent-creds.json");
    expect(await store.get("any")).toBeUndefined();
  });

  test("set and get OAuth credentials", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-creds-oauth-"));
    const filePath = path.join(tmpDir, "creds.json");
    try {
      const store = new FileCredentialStore(filePath);
      const cred: OAuthCredential = {
        accessToken: "at-123",
        refreshToken: "rt-456",
        expiresAt: 1700000000,
        accountId: "user@example.com",
      };
      await store.setOAuth("openai-codex", cred);
      const val = await store.getOAuth("openai-codex");
      expect(val).not.toBeUndefined();
      expect(val!.accessToken).toBe("at-123");
      expect(val!.refreshToken).toBe("rt-456");
      expect(val!.accountId).toBe("user@example.com");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("delete removes key", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-creds-delete-"));
    const filePath = path.join(tmpDir, "creds.json");
    try {
      const store = new FileCredentialStore(filePath);
      await store.set("temp", "value");
      expect(await store.get("temp")).toBe("value");
      await store.delete("temp");
      expect(await store.get("temp")).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("persists across store instances", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-creds-persist-"));
    const filePath = path.join(tmpDir, "creds.json");
    try {
      const store1 = new FileCredentialStore(filePath);
      await store1.set("openai", "key1");

      const store2 = new FileCredentialStore(filePath);
      expect(await store2.get("openai")).toBe("key1");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

import { loadProviderSettings, saveProviderSettings, upsertProvider, resolveProviderSelection, builtinProviderCatalog } from "../src/config/providers.ts";
import type { ProviderConfig, ProviderSettings } from "../src/config/providers.ts";

// === Step 30: Provider Configuration ===

describe("builtinProviderCatalog", () => {
  test("has default providers", () => {
    expect(builtinProviderCatalog.length).toBeGreaterThanOrEqual(3);
    const names = builtinProviderCatalog.map((p) => p.name);
    expect(names).toContain("openai");
    expect(names).toContain("anthropic");
    expect(names).toContain("openrouter");
  });
});

describe("loadProviderSettings", () => {
  test("loads with no file — uses built-in defaults", () => {
    const settings = loadProviderSettings("/tmp/definitely-nonexistent-file.json");
    expect(settings.defaultProvider).toBe("openai");
    expect(settings.providers.length).toBe(builtinProviderCatalog.length);
    expect(settings.scopedModels).toEqual([]);
  });

  test("saves and reloads settings", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-providers-"));
    const filePath = path.join(tmpDir, "providers.json");
    try {
      const settings: ProviderSettings = {
        defaultProvider: "openai",
        providers: [
          {
            kind: "openai_compatible",
            name: "openai",
            baseUrl: "https://api.openai.com/v1",
            models: ["gpt-4o"],
            defaultModel: "gpt-4o",
          },
        ],
        scopedModels: [{ provider: "openai", model: "gpt-4o" }],
      };
      saveProviderSettings(settings, filePath);
      const loaded = loadProviderSettings(filePath);
      expect(loaded.defaultProvider).toBe("openai");
      expect(loaded.providers.find((p) => p.name === "openai")?.defaultModel).toBe("gpt-4o");
      expect(loaded.scopedModels.length).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("upsertProvider", () => {
  test("updates existing provider", () => {
    const settings: ProviderSettings = {
      defaultProvider: "openai",
      providers: [
        { kind: "openai_compatible" as const, name: "openai", baseUrl: "https://old", models: ["gpt-4"], defaultModel: "gpt-4" },
      ],
      scopedModels: [],
    };
    const updated = upsertProvider(settings, {
      kind: "openai_compatible",
      name: "openai",
      baseUrl: "https://new",
      models: ["gpt-5"],
      defaultModel: "gpt-5",
    });
    expect(updated.providers.length).toBe(1);
    expect(updated.providers[0]!.baseUrl).toBe("https://new");
  });

  test("adds new provider", () => {
    const settings: ProviderSettings = {
      defaultProvider: "openai",
      providers: [
        { kind: "openai_compatible" as const, name: "openai", baseUrl: "https://oai", models: ["gpt-4"], defaultModel: "gpt-4" },
      ],
      scopedModels: [],
    };
    const updated = upsertProvider(settings, {
      kind: "anthropic" as const,
      name: "anthropic",
      baseUrl: "https://api.anthropic.com",
      models: ["claude-sonnet-4-6"],
      defaultModel: "claude-sonnet-4-6",
    });
    expect(updated.providers.length).toBe(2);
    expect(updated.providers[1]!.name).toBe("anthropic");
  });
});

describe("resolveProviderSelection", () => {
  test("resolves default provider and model", () => {
    const settings: ProviderSettings = {
      defaultProvider: "openai",
      providers: [
        { kind: "openai_compatible" as const, name: "openai", baseUrl: "https://oai", models: ["gpt-4", "gpt-5"], defaultModel: "gpt-5" },
      ],
      scopedModels: [],
    };
    const resolved = resolveProviderSelection(settings);
    expect(resolved).not.toBeNull();
    expect(resolved!.config.name).toBe("openai");
    expect(resolved!.model).toBe("gpt-5");
  });

  test("resolves with explicit provider and model", () => {
    const settings: ProviderSettings = {
      defaultProvider: "openai",
      providers: [
        { kind: "openai_compatible" as const, name: "openai", baseUrl: "https://oai", models: ["gpt-4", "gpt-5"], defaultModel: "gpt-5" },
        { kind: "anthropic" as const, name: "anthropic", baseUrl: "https://ant", models: ["claude-sonnet-4-6"], defaultModel: "claude-sonnet-4-6" },
      ],
      scopedModels: [],
    };
    const resolved = resolveProviderSelection(settings, "anthropic", "claude-sonnet-4-6");
    expect(resolved).not.toBeNull();
    expect(resolved!.config.name).toBe("anthropic");
  });

  test("returns null for unknown provider", () => {
    const settings: ProviderSettings = {
      defaultProvider: "openai",
      providers: [],
      scopedModels: [],
    };
    expect(resolveProviderSelection(settings, "nonexistent")).toBeNull();
  });

  test("falls back to default model if model not in list", () => {
    const settings: ProviderSettings = {
      defaultProvider: "openai",
      providers: [
        { kind: "openai_compatible" as const, name: "openai", baseUrl: "https://oai", models: ["gpt-4"], defaultModel: "gpt-4" },
      ],
      scopedModels: [],
    };
    const resolved = resolveProviderSelection(settings, "openai", "unknown-model");
    expect(resolved!.model).toBe("gpt-4"); // falls back
  });
});
