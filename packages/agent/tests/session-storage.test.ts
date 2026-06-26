import { describe, expect, test } from "bun:test";
import { InMemorySessionStorage, FsSessionStorage, type SessionStorage } from "../src/session/storage.ts";
import type { SessionEntry } from "../src/session/entries.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: 1234567890,
    message: { role: "user", content: `msg-${id}` },
  } as SessionEntry;
}

async function testStorage(storage: SessionStorage): Promise<void> {
  // Read empty
  let entries = await storage.readAll();
  expect(entries).toEqual([]);

  // Append and read
  await storage.append(makeEntry("a"));
  await storage.append(makeEntry("b"));
  entries = await storage.readAll();
  expect(entries.length).toBe(2);
  expect(entries[0]!.id).toBe("a");
  expect(entries[1]!.id).toBe("b");

  // Append more
  await storage.append(makeEntry("c"));
  entries = await storage.readAll();
  expect(entries.length).toBe(3);
  expect(entries[2]!.id).toBe("c");
}

// ---------------------------------------------------------------------------
// InMemorySessionStorage
// ---------------------------------------------------------------------------

describe("InMemorySessionStorage", () => {
  test("append then readAll returns entries in order", async () => {
    const storage = new InMemorySessionStorage();
    await testStorage(storage);
  });

  test("readAll returns a copy (not a reference)", async () => {
    const storage = new InMemorySessionStorage();
    await storage.append(makeEntry("1"));
    const first = await storage.readAll();
    first.push(makeEntry("2"));
    const second = await storage.readAll();
    expect(second.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FsSessionStorage
// ---------------------------------------------------------------------------

describe("FsSessionStorage", () => {
  test("append then readAll returns entries in order", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-fs-storage-"));
    const filePath = path.join(tmpDir, "session.jsonl");
    const storage = new FsSessionStorage(filePath);
    try {
      await testStorage(storage);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("readAll on nonexistent file returns empty array", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-fs-nonexistent-"));
    const filePath = path.join(tmpDir, "nonexistent.jsonl");
    const storage = new FsSessionStorage(filePath);
    try {
      const entries = await storage.readAll();
      expect(entries).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("append creates the file and persists entries", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-fs-create-"));
    const filePath = path.join(tmpDir, "new.jsonl");
    const storage = new FsSessionStorage(filePath);
    try {
      await storage.append(makeEntry("first"));
      await storage.append(makeEntry("second"));

      // Read back from same storage instance
      const entries = await storage.readAll();
      expect(entries.length).toBe(2);
      expect(entries[0]!.id).toBe("first");
      expect(entries[1]!.id).toBe("second");

      // Verify file exists on disk
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain('"type":"message"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("append multiple entry types", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-fs-types-"));
    const filePath = path.join(tmpDir, "types.jsonl");
    const storage = new FsSessionStorage(filePath);
    try {
      await storage.append({ type: "session_info", id: "1", parentId: null, timestamp: 1, cwd: "/tmp", createdAt: "2025-01-01" } as SessionEntry);
      await storage.append({ type: "model_change", id: "2", parentId: "1", timestamp: 1, model: "gpt-4" } as SessionEntry);
      await storage.append({ type: "message", id: "3", parentId: "2", timestamp: 1, message: { role: "user", content: "hi" } } as SessionEntry);

      const entries = await storage.readAll();
      expect(entries.length).toBe(3);
      expect(entries[0]!.type).toBe("session_info");
      expect(entries[1]!.type).toBe("model_change");
      expect(entries[2]!.type).toBe("message");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
