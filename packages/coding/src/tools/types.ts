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

export async function createCodingTools(_cwd: string): Promise<CodingTool[]> {
  // Stub — will be filled in as tools are implemented
  const tools: CodingTool[] = [];
  return tools;
}
