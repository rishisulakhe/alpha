import { describe, expect, test } from "bun:test";
import { createReadTool } from "../src/tools/read.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { successResult, errorResult } from "../src/tools/types.ts";

// ---------------------------------------------------------------------------
// successResult / errorResult helpers
// ---------------------------------------------------------------------------

describe("successResult / errorResult", () => {
  test("successResult returns ok: true with structured data", () => {
    const r = successResult("call-1", "read", "content", { path: "/tmp/file.txt" });
    expect(r.ok).toBe(true);
    expect(r.toolCallId).toBe("call-1");
    expect(r.name).toBe("read");
    expect(r.content).toBe("content");
    expect(r.data).toEqual({ path: "/tmp/file.txt" });
  });

  test("errorResult returns ok: false with error message", () => {
    const r = errorResult("call-1", "read", "File not found", { path: "/tmp/missing" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("File not found");
    expect(r.content).toBe("File not found");
  });
});

// ---------------------------------------------------------------------------
// Read tool — text files
// ---------------------------------------------------------------------------

describe("Read tool — text files", () => {
  test("reads full file content", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-"));
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "Hello\nWorld\nTest");
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "test.txt" });
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Hello");
      expect(result.content).toContain("World");
      expect(result.content).toContain("Test");
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.totalLines).toBe(3);
        expect(result.data.fileType).toBe("text");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("reads with offset and limit", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-offset-"));
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    fs.writeFileSync(path.join(tmpDir, "test.txt"), lines.join("\n"));
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "test.txt", offset: 3, limit: 2 });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.displayedLines).toBe(2);
      }
      expect(result.content).toContain("Line 3");
      expect(result.content).toContain("Line 4");
      expect(result.content).not.toContain("Line 5");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("offset beyond file returns empty content", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-beyond-"));
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "Only one line");
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "test.txt", offset: 10 });
      expect(result.ok).toBe(true);
      expect(result.content).toBe("");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("nonexistent file returns error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-missing-"));
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "nonexistent.txt" });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects path traversal", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-traversal-"));
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "../etc/passwd" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("traversal");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Read tool — truncation
// ---------------------------------------------------------------------------

describe("Read tool — truncation", () => {
  test("truncates large files and adds hint", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-truncate-"));
    const lines = Array.from({ length: 2500 }, (_, i) => `Line ${i + 1}`);
    fs.writeFileSync(path.join(tmpDir, "large.txt"), lines.join("\n"));
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "large.txt" });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.truncated).toBe(true);
      }
      expect(result.content).toContain("[truncated");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Read tool — image files
// ---------------------------------------------------------------------------

describe("Read tool — image files", () => {
  test("reads image as base64", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-read-image-"));
    // Create a tiny valid PNG (1x1 pixel, minimal)
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xD7, 0x63, 0x68, 0x00, 0x00, 0x00,
      0x82, 0x00, 0x81, 0x00, 0x00, 0x00, 0x00, 0x49, // IEND
      0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]);
    fs.writeFileSync(path.join(tmpDir, "icon.png"), pngData);
    try {
      const tool = createReadTool(tmpDir);
      const result = await tool.execute({ filePath: "icon.png" });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.fileType).toBe("image");
        expect(result.data.mimeType).toBe("image/png");
        expect(result.data.base64).toBeTypeOf("string");
        expect(result.data.base64).toContain("base64");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
