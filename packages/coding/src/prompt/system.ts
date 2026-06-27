import type { Skill } from "../resources/skills.ts";
import { formatSkillsForSystemPrompt } from "../resources/skills.ts";
import type { CodingTool } from "../tools/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildSystemPromptOptions {
  cwd: string;
  tools: CodingTool[];
  skills: Skill[];
  customPrompt?: string;
  appendPrompt?: string;
  contextFiles?: Array<{ path: string; content: string }>;
  currentDate?: string;
  extraGuidelines?: string;
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const parts: string[] = [];
  const hasReadTool = opts.tools.some((t) => t.name === "read");
  const date = opts.currentDate ?? new Date().toISOString().slice(0, 10);

  if (opts.customPrompt !== undefined) {
    // Custom prompt replaces the role intro + tools + guidelines
    if (opts.customPrompt) {
      parts.push(opts.customPrompt);
    }
  } else {
    // 1. Role introduction
    parts.push(
      "You are an expert coding assistant operating inside Alpha, a terminal-based coding agent." +
        " You have access to tools to read, write, edit files and run shell commands.",
    );

    // 2. Available tools
    const toolSnippets = opts.tools
      .filter((t) => t.promptSnippet)
      .map((t) => `- ${t.promptSnippet}`);
    if (toolSnippets.length > 0) {
      parts.push("\n## Available tools\n" + toolSnippets.join("\n"));
    }

    // 3. Tool guidelines (deduplicated)
    const guidelines = new Set<string>();
    for (const tool of opts.tools) {
      if (tool.promptGuidelines) {
        for (const line of tool.promptGuidelines.split("\n").map((l) => l.trim()).filter(Boolean)) {
          guidelines.add(line);
        }
      }
    }
    if (opts.extraGuidelines) {
      for (const line of opts.extraGuidelines.split("\n").map((l) => l.trim()).filter(Boolean)) {
        guidelines.add(line);
      }
    }
    if (guidelines.size > 0) {
      const guidelineList = [...guidelines].map((g, i) => `${i + 1}. ${g}`);
      parts.push("\n## Guidelines\n" + guidelineList.join("\n"));
    }
  }

  // 4. Append prompt
  if (opts.appendPrompt) {
    parts.push("\n" + opts.appendPrompt);
  }

  // 5. Project context files
  if (opts.contextFiles && opts.contextFiles.length > 0) {
    parts.push("\n## Project context");
    for (const cf of opts.contextFiles) {
      parts.push(`\n<context name="${_escapeXml(cf.path)}">\n${cf.content}\n</context>`);
    }
  }

  // 6. Skills index
  if (hasReadTool && opts.skills.length > 0) {
    parts.push("\n" + formatSkillsForSystemPrompt(opts.skills, true));
  }

  // 7. Date and CWD
  parts.push(`\nCurrent date: ${date}. Working directory: ${opts.cwd}`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
