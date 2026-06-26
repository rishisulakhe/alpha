import type { AgentToolResult } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

// ---------------------------------------------------------------------------
// createReadTool
// ---------------------------------------------------------------------------

export function createReadTool(cwd: string): CodingTool {
  return {
    name: "read",
    description: "Read a file from the local filesystem. Supports text and image files.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file to read, relative to the working directory." },
        offset: { type: "number", description: "Line number to start reading from (1-indexed). Default: 1." },
        limit: { type: "number", description: "Maximum number of lines to read. Default: 2000." },
      },
      required: ["filePath"],
    },
    promptSnippet: "read(filePath: string, offset?: number, limit?: number) — Read a file from disk.",
    promptGuidelines: "Use the read tool to inspect file contents before editing. Specify offset and limit for large files.",
    async execute(args, _signal): Promise<AgentToolResult> {
      const filePath = String(args.filePath ?? "");
      const offset = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : 1;
      const limit = typeof args.limit === "number" ? Math.max(1, Math.floor(args.limit)) : MAX_OUTPUT_LINES;

      if (!filePath) {
        return errorResult("", "read", "filePath is required");
      }

      const fullPath = path.resolve(cwd, filePath);
      if (!fullPath.startsWith(cwd + path.sep) && fullPath !== cwd) {
        return errorResult("", "read", `Path traversal detected: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();

      // Image handling
      if (IMAGE_EXTENSIONS.has(ext)) {
        return _readImage(fullPath, filePath);
      }

      // Text file handling
      return _readText(fullPath, filePath, offset, limit);
    },
  };
}

// ---------------------------------------------------------------------------
// Text file reader
// ---------------------------------------------------------------------------

async function _readText(fullPath: string, displayPath: string, offset: number, limit: number): Promise<AgentToolResult> {
  let raw: string;
  try {
    const file = Bun.file(fullPath);
    raw = await file.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult("", "read", msg, { path: displayPath });
  }

  const lines = raw.split("\n");
  const totalLines = lines.length;
  const totalBytes = new TextEncoder().encode(raw).length;

  const startIdx = offset - 1;
  if (startIdx >= totalLines) {
    return successResult("", "read", "", {
      path: displayPath,
      totalLines,
      displayedLines: 0,
      truncated: false,
      fileType: "text",
    });
  }

  const endIdx = Math.min(startIdx + limit, totalLines);
  let selected = lines.slice(startIdx, endIdx).join("\n");
  let displayedLines = endIdx - startIdx;
  let truncated = false;

  // Line truncation
  if (displayedLines >= MAX_OUTPUT_LINES || endIdx < totalLines) {
    truncated = true;
  }

  // Byte truncation
  const byteLen = new TextEncoder().encode(selected).length;
  if (byteLen > MAX_OUTPUT_BYTES) {
    // Find the largest substring within byte limit
    let truncatedContent = "";
    let currentBytes = 0;
    for (const line of selected.split("\n")) {
      const lineBytes = new TextEncoder().encode(line + "\n").length;
      if (currentBytes + lineBytes > MAX_OUTPUT_BYTES) break;
      truncatedContent += (truncatedContent ? "\n" : "") + line;
      currentBytes += lineBytes;
    }
    selected = truncatedContent;
    displayedLines = selected.split("\n").length;
    truncated = true;
  }

  let content = selected;
  if (truncated) {
    const kb = (totalBytes / 1024).toFixed(1);
    content += `\n... [truncated — ${totalLines} lines / ${kb} KB total]`;
  }

  return successResult("", "read", content, {
    path: displayPath,
    totalLines,
    displayedLines,
    truncated,
    fileType: "text",
  });
}

// ---------------------------------------------------------------------------
// Image file reader
// ---------------------------------------------------------------------------

async function _readImage(fullPath: string, displayPath: string): Promise<AgentToolResult> {
  try {
    const file = Bun.file(fullPath);
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = _mimeForExtension(ext);

    const content = `[Image: ${displayPath}]`;
    return successResult("", "read", content, {
      path: displayPath,
      fileType: "image",
      mimeType,
      base64: `data:${mimeType};base64,${base64}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult("", "read", msg, { path: displayPath, fileType: "image" });
  }
}

function _mimeForExtension(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return map[ext] ?? "application/octet-stream";
}
