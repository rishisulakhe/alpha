import type { AgentToolResult, JSONObject } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import * as path from "node:path";

interface EditItem {
  oldText: string;
  newText: string;
}

export function createEditTool(cwd: string): CodingTool {
  return {
    name: "edit",
    description: "Apply exact text replacements to a single file. Each oldText must match exactly once.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file to edit, relative to the working directory." },
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
          },
        },
      },
      required: ["filePath", "edits"],
    },
    promptSnippet: "edit(filePath: string, edits: { oldText: string, newText: string }[]) — Apply exact text replacements.",
    promptGuidelines: "Use edit for precise changes. Each oldText must match exactly once. Keep oldText small but unique.",
    async execute(args): Promise<AgentToolResult> {
      const filePath = String(args.filePath ?? "");
      const rawEdits = args.edits as Array<Record<string, unknown>> | undefined;

      if (!filePath) return errorResult("", "edit", "filePath is required");

      if (!rawEdits || !Array.isArray(rawEdits) || rawEdits.length === 0) {
        return errorResult("", "edit", "edits must be a non-empty array");
      }

      const edits: EditItem[] = [];
      for (let i = 0; i < rawEdits.length; i++) {
        const item = rawEdits[i]!;
        const oldText = String(item.oldText ?? "");
        const newText = String(item.newText ?? "");
        if (!oldText) {
          return errorResult("", "edit", `edits[${i}].oldText must be non-empty`);
        }
        edits.push({ oldText, newText });
      }

      const fullPath = path.resolve(cwd, filePath);
      if (!fullPath.startsWith(cwd + path.sep) && fullPath !== cwd) {
        return errorResult("", "edit", `Path traversal detected: ${filePath}`);
      }

      let originalContent: string;
      try {
        originalContent = await Bun.file(fullPath).text();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "edit", `Cannot read file: ${msg}`, { filePath });
      }

      // Validate all edits before applying
      for (let i = 0; i < edits.length; i++) {
        const { oldText } = edits[i]!;
        const count = countOccurrences(originalContent, oldText);
        if (count === 0) {
          return errorResult("", "edit", `edits[${i}]: oldText not found in file.`, { filePath, editIndex: i });
        }
        if (count > 1) {
          return errorResult("", "edit", `edits[${i}]: oldText matches ${count} locations, must be unique.`, {
            filePath,
            editIndex: i,
            matchCount: count,
          });
        }
      }

      // Apply edits from last to first to preserve positions
      let newContent = originalContent;
      for (let i = edits.length - 1; i >= 0; i--) {
        const { oldText, newText } = edits[i]!;
        const idx = newContent.indexOf(oldText);
        if (idx === -1) {
          // This shouldn't happen since we validated
          return errorResult("", "edit", `edits[${i}]: oldText not found after applying previous edits.`, {
            filePath,
            editIndex: i,
          });
        }
        newContent = newContent.slice(0, idx) + newText + newContent.slice(idx + oldText.length);
      }

      // Create backup
      try {
        await Bun.write(fullPath + ".bak", originalContent);
      } catch {
        // Backup is best-effort
      }

      try {
        await Bun.write(fullPath, newContent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "edit", `Failed to write: ${msg}`, { filePath });
      }

      const patch = generatePatch(filePath, originalContent, newContent);

      return successResult("", "edit", `Successfully applied ${edits.length} edit(s) to ${filePath}.`, {
        filePath,
        appliedEdits: edits.length,
        patch,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function generatePatch(filePath: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");

  const patch: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  // Simple line-by-line diff
  let i = 0;
  while (i < origLines.length || i < modLines.length) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const modLine = i < modLines.length ? modLines[i] : undefined;

    if (origLine === modLine) {
      i++;
      continue;
    }

    // Changed block starts here
    const blockStart = i;
    let blockEnd = i;

    // Find end of changed block
    while (blockEnd < origLines.length || blockEnd < modLines.length) {
      const o = blockEnd < origLines.length ? origLines[blockEnd] : undefined;
      const m = blockEnd < modLines.length ? modLines[blockEnd] : undefined;
      if (o === m && blockEnd > blockStart) break;
      blockEnd++;
    }

    const headerHunk = `@@ -${blockStart + 1},${blockEnd - blockStart} +${blockStart + 1},${blockEnd - blockStart} @@`;
    patch.push(headerHunk);

    for (let j = blockStart; j < blockEnd; j++) {
      if (j < origLines.length) {
        patch.push(`-${origLines[j]}`);
      }
      if (j < modLines.length) {
        patch.push(`+${modLines[j]}`);
      }
    }

    i = blockEnd;
  }

  return patch.join("\n");
}
