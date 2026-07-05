import type { AgentTool, AgentToolResult, CancellationToken, JSONObject } from "@alpha/agent";

// ---------------------------------------------------------------------------
// CodingTool — extends AgentTool with prompt metadata
// ---------------------------------------------------------------------------

export interface CodingTool extends AgentTool {
  promptSnippet: string;
  promptGuidelines: string;
}

// ---------------------------------------------------------------------------
// ToolDefinition — factory configuration for a coding tool
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONObject;
  promptSnippet: string;
  promptGuidelines: string;
  create: (cwd: string) => CodingTool;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export function successResult(
  toolCallId: string,
  name: string,
  content: string,
  data?: JSONObject,
): AgentToolResult {
  return { toolCallId, name, ok: true, content, data };
}

export function errorResult(
  toolCallId: string,
  name: string,
  error: string,
  data?: JSONObject,
): AgentToolResult {
  return { toolCallId, name, ok: false, content: error, error, data };
}

// ---------------------------------------------------------------------------
// createCodingTools — factory for all four built-in tools
// ---------------------------------------------------------------------------

import { createReadTool } from "./read.ts";
import { createWriteTool } from "./write.ts";
import { createEditTool } from "./edit.ts";
import { createBashTool } from "./bash.ts";

export async function createCodingTools(cwd: string): Promise<CodingTool[]> {
  const tools: CodingTool[] = [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createBashTool(cwd),
  ];
  return tools;
}

// ---------------------------------------------------------------------------
// Re-export truncation utilities
// ---------------------------------------------------------------------------

export {
  truncateHead,
  truncateTail,
  formatSize,
  DEFAULT_MAX_OUTPUT_LINES,
  DEFAULT_MAX_OUTPUT_BYTES,
  type TruncationResult,
} from "./truncation.ts";
