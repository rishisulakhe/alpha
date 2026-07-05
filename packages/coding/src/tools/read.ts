/**
 * Read tool for Alpha coding sessions.
 *
 * Reads files from the local filesystem with support for:
 * - Text files with line-based truncation
 * - Image files (jpg, png, gif, webp, bmp) as base64
 * - Proper continuation hints for large files
 *
 * Matches Tau's read tool behavior.
 */

import type { AgentToolResult, JSONObject } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import { truncateHead, formatSize, DEFAULT_MAX_OUTPUT_LINES, DEFAULT_MAX_OUTPUT_BYTES } from "./truncation.ts";
import * as path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Supported image MIME types
// ---------------------------------------------------------------------------

const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);

// ---------------------------------------------------------------------------
// createReadTool
// ---------------------------------------------------------------------------

export function createReadTool(cwd: string): CodingTool {
  return {
    name: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_OUTPUT_LINES} lines or ${DEFAULT_MAX_OUTPUT_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read (relative or absolute)" },
        offset: { type: "integer", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "integer", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    promptSnippet: "Read file contents",
    promptGuidelines: "Use read to examine files instead of cat or sed.",
    async execute(args, _signal): Promise<AgentToolResult> {
      const rawPath = String(args.path ?? "");

      if (!rawPath) {
        return errorResult("", "read", "path is required");
      }

      // Validate and resolve path
      const normalizedPath = _resolvePath(rawPath, cwd);
      const offset = _optionalIntArg(args.offset);
      const limit = _optionalIntArg(args.limit);

      if (offset !== null && offset < 0) {
        return errorResult("", "read", "offset must be at least 0");
      }
      if (limit !== null && limit < 1) {
        return errorResult("", "read", "limit must be at least 1");
      }

      // Check file existence
      if (!existsSync(normalizedPath)) {
        return errorResult("", "read", `File not found: ${rawPath}`);
      }

      // Check if directory
      try {
        const stats = statSync(normalizedPath);
        if (stats.isDirectory()) {
          return errorResult("", "read", `Path is a directory: ${rawPath}`);
        }
      } catch {
        // Fall through
      }

      // Check for image file
      const mimeType = _detectSupportedImageMimeType(normalizedPath);
      if (mimeType !== null) {
        return _readImage(normalizedPath, rawPath, mimeType);
      }

      // Read as text
      return _readText(normalizedPath, rawPath, { offset, limit });
    },
  };
}

// ---------------------------------------------------------------------------
// Text file reading
// ---------------------------------------------------------------------------

interface TextReadOptions {
  offset: number | null;
  limit: number | null;
}

async function _readText(
  normalizedPath: string,
  rawPath: string,
  opts: TextReadOptions,
): Promise<AgentToolResult> {
  let content: string;
  try {
    content = readFileSync(normalizedPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult("", "read", msg, { path: rawPath });
  }

  const lines = content.split("\n");
  const totalLines = lines.length;

  // Calculate offset (1-indexed to 0-indexed)
  const startLine = opts.offset == null || opts.offset === 0 ? 0 : opts.offset - 1;

  if (startLine >= totalLines) {
    return errorResult("", "read", `Offset ${opts.offset} is beyond end of file (${totalLines} lines total)`);
  }

  // Apply user limit first if specified
  let selected: string;
  let userLimitedLines: number | null = null;

  if (opts.limit !== null) {
    const endLine = Math.min(startLine + opts.limit, totalLines);
    selected = lines.slice(startLine, endLine).join("\n");
    userLimitedLines = endLine - startLine;
  } else {
    selected = lines.slice(startLine).join("\n");
  }

  // Apply truncation
  const truncation = truncateHead(selected);

  const startDisplay = startLine + 1;
  const data: JSONObject = {
    path: rawPath,
    truncation: {
      truncated: truncation.truncated,
      truncatedBy: truncation.truncatedBy,
      totalLines: truncation.totalLines,
      outputLines: truncation.outputLines,
      outputBytes: truncation.outputBytes,
    },
  };

  // Build output with continuation hints
  let output: string;

  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(new TextEncoder().encode(lines[startLine] ?? "").length);
    output = `[Line ${startDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_OUTPUT_BYTES)} limit. Use bash: sed -n '${startDisplay}p' ${rawPath} | head -c ${DEFAULT_MAX_OUTPUT_BYTES}]`;
  } else if (truncation.truncated) {
    const endDisplay = startDisplay + truncation.outputLines - 1;
    const nextOffset = endDisplay + 1;

    if (truncation.truncatedBy === "lines") {
      output = `${truncation.content}\n\n[Showing lines ${startDisplay}-${endDisplay} of ${totalLines}. Use offset=${nextOffset} to continue.]`;
    } else {
      output = `${truncation.content}\n\n[Showing lines ${startDisplay}-${endDisplay} of ${totalLines} (${formatSize(DEFAULT_MAX_OUTPUT_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
    }
  } else if (userLimitedLines !== null && startLine + userLimitedLines < totalLines) {
    const remaining = totalLines - (startLine + userLimitedLines);
    const nextOffset = startLine + userLimitedLines + 1;
    output = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  } else {
    output = truncation.content;
  }

  return successResult("", "read", output, data);
}

// ---------------------------------------------------------------------------
// Image file reading
// ---------------------------------------------------------------------------

async function _readImage(
  normalizedPath: string,
  rawPath: string,
  mimeType: string,
): Promise<AgentToolResult> {
  try {
    const buffer = readFileSync(normalizedPath);
    const base64 = buffer.toString("base64");

    return successResult("", "read", `Read image file [${mimeType}]`, {
      path: rawPath,
      mime_type: mimeType,
      bytes: buffer.byteLength,
      image_base64: base64,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult("", "read", msg, { path: rawPath, mime_type: mimeType });
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function _resolvePath(rawPath: string, cwd: string): string {
  // Expand ~ for home directory
  let p = rawPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", rawPath.slice(1))
    : rawPath;

  // If not absolute, resolve against cwd
  if (!path.isAbsolute(p)) {
    p = path.resolve(cwd, p);
  }

  return p;
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function _optionalIntArg(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// MIME type detection
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

function _detectSupportedImageMimeType(normalizedPath: string): string | null {
  const ext = path.extname(normalizedPath).toLowerCase();
  const mimeType = MIME_MAP[ext];
  return mimeType && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}
