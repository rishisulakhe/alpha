import type { AgentToolResult } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import * as path from "node:path";
import { mkdirSync } from "node:fs";

export function createWriteTool(cwd: string): CodingTool {
  return {
    name: "write",
    description: "Create or overwrite a file with the given content.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file, relative to the working directory." },
        content: { type: "string", description: "UTF-8 content to write to the file." },
      },
      required: ["filePath", "content"],
    },
    promptSnippet: "write(filePath: string, content: string) — Create or overwrite a file.",
    promptGuidelines: "Use write to create new files or overwrite existing ones. Creates parent directories as needed.",
    async execute(args): Promise<AgentToolResult> {
      const filePath = String(args.filePath ?? "");
      const content = String(args.content ?? "");

      if (!filePath) {
        return errorResult("", "write", "filePath is required");
      }

      const fullPath = path.resolve(cwd, filePath);
      if (!fullPath.startsWith(cwd + path.sep) && fullPath !== cwd) {
        return errorResult("", "write", `Path traversal detected: ${filePath}`);
      }

      const dir = path.dirname(fullPath);
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        return errorResult("", "write", `Failed to create parent directories for: ${filePath}`);
      }

      try {
        await Bun.write(fullPath, content);
        const bytes = new TextEncoder().encode(content).length;
        return successResult("", "write", `Successfully wrote ${filePath} (${bytes} bytes)`, {
          filePath,
          bytesWritten: bytes,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "write", msg, { filePath });
      }
    },
  };
}
