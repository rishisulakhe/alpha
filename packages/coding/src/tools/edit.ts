/**
 * Edit tool for Alpha coding sessions.
 *
 * Applies exact text replacements to a single UTF-8 file with:
 * - Non-overlapping edit validation
 * - Line ending preservation (CRLF/LF)
 * - Diff and unified patch generation
 * - Backup file creation
 *
 * Matches Tau's edit tool behavior.
 */

import type { AgentToolResult } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import * as path from "node:path";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Edit item type
// ---------------------------------------------------------------------------

interface EditItem {
  oldText: string;
  newText: string;
}

// ---------------------------------------------------------------------------
// UTF-8 BOM
// ---------------------------------------------------------------------------

const UTF8_BOM = "\ufeff";

// ---------------------------------------------------------------------------
// createEditTool
// ---------------------------------------------------------------------------

export function createEditTool(cwd: string): CodingTool {
  return {
    name: "edit",
    description: `Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
        edits: {
          type: "array",
          description: "One or more targeted replacements.",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "edits"],
      additionalProperties: false,
    },
    promptSnippet: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText must match exactly)",
      "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
      "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ].join(" "),
    async execute(args, _signal): Promise<AgentToolResult> {
      // Prepare and validate arguments
      const prepared = _prepareEditArguments(args);
      const rawPath = String(prepared.path ?? "");

      if (!rawPath) {
        return errorResult("", "edit", "path is required");
      }

      // Resolve path
      const fullPath = _resolvePath(rawPath, cwd);

      // Parse edits
      let edits: EditItem[];
      try {
        edits = _editsArg(prepared);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "edit", msg);
      }

      // Check file exists
      if (!existsSync(fullPath)) {
        return errorResult("", "edit", `Could not edit file: ${rawPath}. File not found.`);
      }

      // Check not directory
      try {
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          return errorResult("", "edit", `Could not edit file: ${rawPath}. Path is a directory.`);
        }
      } catch {
        // Fall through
      }

      // Read file
      let rawContent: string;
      try {
        rawContent = readFileSync(fullPath, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "edit", `Could not read file: ${rawPath}. ${msg}`);
      }

      // Strip BOM and detect line ending
      const [bom, content] = _stripBom(rawContent);
      const originalEnding = detectLineEnding(content);
      const normalized = normalizeToLf(content);

      // Apply edits to normalized content
      let newContent: string;
      try {
        const result = applyEditsToNormalizedContent(normalized, edits, rawPath);
        newContent = result.newContent;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "edit", msg);
      }

      // Restore line endings and BOM
      const finalContent = bom + restoreLineEndings(newContent, originalEnding);

      // Write file atomically (best effort)
      try {
        writeFileSync(fullPath, finalContent, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "edit", `Could not write file: ${rawPath}. ${msg}`);
      }

      // Generate diff and patch
      const diffText = generateDiffString(normalized, newContent);
      const firstChangedLine = findFirstChangedLine(normalized, newContent);
      const patch = generateUnifiedPatch(rawPath, normalized, newContent);

      return successResult("", "edit", `Successfully replaced ${edits.length} block(s) in ${rawPath}.`, {
        path: rawPath,
        edits: edits.length,
        diff: diffText,
        patch,
        first_changed_line: firstChangedLine,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Apply edits to content
// ---------------------------------------------------------------------------

export interface EditContentResult {
  /** Original normalized content */
  originalContent: string;
  /** New content after applying edits */
  newContent: string;
}

export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: EditItem[],
  filePath: string,
): EditContentResult {
  // Normalize edit texts
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLf(edit.oldText),
    newText: normalizeToLf(edit.newText),
  }));

  // Validate: no empty oldText
  for (let i = 0; i < normalizedEdits.length; i++) {
    if (!normalizedEdits[i]!.oldText) {
      throw new Error(_emptyOldTextError(filePath, i, normalizedEdits.length));
    }
  }

  // Find all matches
  const matches: Array<[number, number, string]> = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const { oldText } = normalizedEdits[i]!;
    const occurrences = _countOccurrences(normalizedContent, oldText);

    if (occurrences === 0) {
      throw new Error(_notFoundError(filePath, i, normalizedEdits.length));
    }
    if (occurrences > 1) {
      throw new Error(_duplicateError(filePath, i, normalizedEdits.length, occurrences));
    }

    const start = normalizedContent.indexOf(oldText);
    const newText = normalizedEdits[i]!.newText;
    matches.push([start, start + oldText.length, newText]);
  }

  // Validate no overlaps
  _validateNonOverlapping(matches);

  // Apply edits from end to start to preserve positions
  let newContent = normalizedContent;
  for (const [start, end, newText] of matches.sort((a, b) => b[0] - a[0])) {
    newContent = newContent.slice(0, start) + newText + newContent.slice(end);
  }

  // Check for no-op
  if (newContent === normalizedContent) {
    throw new Error(_noChangeError(filePath, normalizedEdits.length));
  }

  return { originalContent: normalizedContent, newContent };
}

// ---------------------------------------------------------------------------
// Line ending utilities
// ---------------------------------------------------------------------------

export function detectLineEnding(content: string): string {
  const crlfIndex = content.indexOf("\r\n");
  const lfIndex = content.indexOf("\n");

  if (lfIndex === -1 || crlfIndex === -1) return "\n";
  return crlfIndex < lfIndex ? "\r\n" : "\n";
}

export function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: string): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

// ---------------------------------------------------------------------------
// Diff generation
// ---------------------------------------------------------------------------

export function generateDiffString(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const result: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      result.push(`+${newLine}`);
    } else if (newLine === undefined) {
      result.push(`-${oldLine}`);
    } else if (oldLine === newLine) {
      result.push(` ${oldLine}`);
    } else {
      result.push(`-${oldLine}`);
      result.push(`+${newLine}`);
    }
  }

  return result.join("\n");
}

export function generateUnifiedPatch(filePath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  // Find first and last differing lines
  let firstDiff = -1;
  let lastDiff = -1;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      if (firstDiff === -1) firstDiff = i;
      lastDiff = i;
    }
  }

  if (firstDiff === -1) {
    return lines.join("\n") + "\n";
  }

  // Add context
  const contextStart = Math.max(0, firstDiff - 3);
  const contextEnd = Math.min(Math.max(oldLines.length, newLines.length), lastDiff + 4);

  const oldCount = Math.min(oldLines.length, contextEnd) - contextStart;
  const newCount = Math.min(newLines.length, contextEnd) - contextStart;

  lines.push(`@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`);

  for (let i = contextStart; i < contextEnd; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      lines.push(`+${newLine}`);
    } else if (newLine === undefined) {
      lines.push(`-${oldLine}`);
    } else if (oldLine === newLine) {
      lines.push(` ${oldLine}`);
    } else {
      lines.push(`-${oldLine}`);
      lines.push(`+${newLine}`);
    }
  }

  return lines.join("\n");
}

export function findFirstChangedLine(oldContent: string, newContent: string): number | null {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  let newLineNum = 0;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      // Line added at end
      return newLineNum + 1;
    }
    if (newLine === undefined) {
      // Line removed from end, return next line number
      return newLineNum + 1;
    }
    if (oldLine !== newLine) {
      // Line changed
      return newLineNum + 1;
    }
    newLineNum++;
  }

  return null; // No changes
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function _prepareEditArguments(args: Record<string, unknown>): Record<string, unknown> {
  const prepared = { ...args };

  // Handle JSON-string edits
  const editsValue = prepared.edits;
  if (typeof editsValue === "string") {
    try {
      const parsed = JSON.parse(editsValue);
      if (Array.isArray(parsed)) {
        prepared.edits = parsed;
      }
    } catch {
      // Keep as-is
    }
  }

  // Handle legacy top-level oldText/newText
  const oldText = prepared.oldText;
  const newText = prepared.newText;
  if (typeof oldText === "string" && typeof newText === "string") {
    const edits = Array.isArray(prepared.edits) ? prepared.edits : [];
    prepared.edits = [...edits, { oldText, newText }];
    delete prepared.oldText;
    delete prepared.newText;
  }

  return prepared;
}

function _editsArg(args: Record<string, unknown>): EditItem[] {
  const value = args.edits;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
  }

  const edits: EditItem[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "object" || item === null) {
      throw new Error(`edits[${i}] must be an object`);
    }

    const obj = item as Record<string, unknown>;
    const oldText = obj.oldText;
    const newText = obj.newText;

    if (typeof oldText !== "string" || typeof newText !== "string") {
      throw new Error(`edits[${i}].oldText and edits[${i}].newText must be strings`);
    }

    edits.push({ oldText, newText });
  }

  return edits;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function _validateNonOverlapping(spans: Array<[number, number, string]>): void {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let prevEnd = -1;

  for (const [start, end] of sorted) {
    if (start < prevEnd) {
      throw new Error("Edits must not overlap");
    }
    prevEnd = end;
  }
}

// ---------------------------------------------------------------------------
// Counting helpers
// ---------------------------------------------------------------------------

function _countOccurrences(content: string, text: string): number {
  if (!text) return 0;

  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(text, pos)) !== -1) {
    count++;
    pos += text.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

function _notFoundError(filePath: string, editIndex: number, totalEdits: number): string {
  if (totalEdits === 1) {
    return `Could not find the exact text in ${filePath}. The old text must match exactly including all whitespace and newlines.`;
  }
  return `Could not find edits[${editIndex}] in ${filePath}. The oldText must match exactly including all whitespace and newlines.`;
}

function _duplicateError(filePath: string, editIndex: number, totalEdits: number, occurrences: number): string {
  if (totalEdits === 1) {
    return `Found ${occurrences} occurrences of the text in ${filePath}. The text must be unique. Please provide more context to make it unique.`;
  }
  return `Found ${occurrences} occurrences of edits[${editIndex}] in ${filePath}. Each oldText must be unique. Please provide more context to make it unique.`;
}

function _emptyOldTextError(filePath: string, editIndex: number, totalEdits: number): string {
  if (totalEdits === 1) {
    return `oldText must not be empty in ${filePath}.`;
  }
  return `edits[${editIndex}].oldText must not be empty in ${filePath}.`;
}

function _noChangeError(filePath: string, totalEdits: number): string {
  if (totalEdits === 1) {
    return `No changes made to ${filePath}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`;
  }
  return `No changes made to ${filePath}. The replacements produced identical content.`;
}

// ---------------------------------------------------------------------------
// BOM handling
// ---------------------------------------------------------------------------

function _stripBom(content: string): [string, string] {
  if (content.startsWith(UTF8_BOM)) {
    return [UTF8_BOM, content.slice(1)];
  }
  return ["", content];
}

// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

function _resolvePath(rawPath: string, cwd: string): string {
  let p = rawPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", rawPath.slice(1))
    : rawPath;

  if (!path.isAbsolute(p)) {
    p = path.resolve(cwd, p);
  }

  return p;
}
