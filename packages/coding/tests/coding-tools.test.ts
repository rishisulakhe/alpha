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
  test("successResult returns ok: true with structured data", async () => {
    const r = successResult("call-1", "read", "content", { path: "/tmp/file.txt" });
    expect(r.ok).toBe(true);
    expect(r.toolCallId).toBe("call-1");
    expect(r.name).toBe("read");
    expect(r.content).toBe("content");
    expect(r.data).toEqual({ path: "/tmp/file.txt" });
  });

  test("errorResult returns ok: false with error message", async () => {
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

import { createWriteTool } from "../src/tools/write.ts";
import { createEditTool } from "../src/tools/edit.ts";

// === Write tool ===

describe("Write tool", () => {
  test("creates a file with content", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-write-"));
    const filePath = path.join(tmpDir, "new-file.txt");
    try {
      const tool = createWriteTool(tmpDir);
      const result = await tool.execute({ filePath: "new-file.txt", content: "Hello world" });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      
      const written = fs.readFileSync(filePath, "utf-8");
      expect(written).toBe("Hello world");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("overwrites existing file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-write-overwrite-"));
    const filePath = path.join(tmpDir, "existing.txt");
    fs.writeFileSync(filePath, "old content");
    try {
      const tool = createWriteTool(tmpDir);
      const result = await tool.execute({ filePath: "existing.txt", content: "new content" });
      expect(result.ok).toBe(true);
      const written = fs.readFileSync(filePath, "utf-8");
      expect(written).toBe("new content");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("creates parent directories", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-write-nested-"));
    try {
      const tool = createWriteTool(tmpDir);
      const result = await tool.execute({ filePath: "deeply/nested/file.txt", content: "nested" });
      expect(result.ok).toBe(true);
      const nestedPath = path.join(tmpDir, "deeply", "nested", "file.txt");
      expect(fs.existsSync(nestedPath)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects path traversal", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-write-traversal-"));
    try {
      const tool = createWriteTool(tmpDir);
      const result = await tool.execute({ filePath: "../../etc/hosts", content: "evil" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("traversal");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// === Edit tool ===

describe("Edit tool — single replacement", () => {
  test("applies a single text replacement", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-"));
    const filePath = path.join(tmpDir, "code.ts");
    fs.writeFileSync(filePath, "const x = 1;\nconst y = 2;");
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "code.ts",
        edits: [{ oldText: "const x = 1;", newText: "const x = 10;" }],
      });
      expect(result.ok).toBe(true);
      if (result.data) {
        expect(result.data.appliedEdits).toBe(1);
      }
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe("const x = 10;\nconst y = 2;");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("applies multiple replacements", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-multi-"));
    const filePath = path.join(tmpDir, "code.ts");
    fs.writeFileSync(filePath, "first\nsecond\nthird");
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "code.ts",
        edits: [
          { oldText: "first", newText: "1st" },
          { oldText: "third", newText: "3rd" },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.data) {
        expect(result.data.appliedEdits).toBe(2);
      }
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe("1st\nsecond\n3rd");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns error when oldText not found", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-notfound-"));
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "original content");
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "file.txt",
        edits: [{ oldText: "nonexistent", newText: "replacement" }],
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not found");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns error when oldText matches multiple times", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-multi-match-"));
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "dup\ndup\ndup");
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "file.txt",
        edits: [{ oldText: "dup", newText: "unique" }],
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("3 locations");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("rolls back — file unchanged when any edit fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-rollback-"));
    const filePath = path.join(tmpDir, "important.txt");
    const original = "line1\nline2\nline3";
    fs.writeFileSync(filePath, original);
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "important.txt",
        edits: [
          { oldText: "line1", newText: "modified" }, // valid
          { oldText: "nonexistent", newText: "fail" }, // invalid
        ],
      });
      expect(result.ok).toBe(false);
      // File should be unchanged
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe(original);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("edits non-unique oldText returns error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-nonunique-"));
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "lineA\nlineB\nlineA");
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "file.txt",
        edits: [{ oldText: "lineA", newText: "changed" }],
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("2 locations");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates a patch in the result data", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-edit-patch-"));
    const filePath = path.join(tmpDir, "code.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    try {
      const tool = createEditTool(tmpDir);
      const result = await tool.execute({
        filePath: "code.ts",
        edits: [{ oldText: "1", newText: "42" }],
      });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.patch).toBeTypeOf("string");
        expect(result.data.patch).toContain("--- a/code.ts");
        expect(result.data.patch).toContain("+++ b/code.ts");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// === createCodingTools ===

import { createCodingTools } from "../src/tools/types.ts";

describe("createCodingTools", () => {
  test("returns three tools with correct names (read, write, edit)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-tools-factory-"));
    try {
      const tools = await createCodingTools(tmpDir);
      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.name)).toEqual(["read", "write", "edit"]);
      // Each tool should have required CodingTool metadata
      for (const tool of tools) {
        expect(tool.promptSnippet).toBeTypeOf("string");
        expect(tool.promptGuidelines).toBeTypeOf("string");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
