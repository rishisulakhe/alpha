import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptTemplate {
  name: string;
  description?: string;
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (shared pattern with skills)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; content: string } {
  const lines = raw.split("\n");
  const frontmatter: Record<string, string> = {};

  if (lines[0]?.trim() === "---") {
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        endIdx = i;
        break;
      }
      const match = lines[i]?.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
      if (match) {
        frontmatter[match[1]!] = (match[2] ?? "").trim();
      }
    }
    if (endIdx > 0) {
      return { frontmatter, content: lines.slice(endIdx + 1).join("\n").trim() };
    }
  }

  return { frontmatter, content: raw.trim() };
}

// ---------------------------------------------------------------------------
// loadPromptTemplates
// ---------------------------------------------------------------------------

export function loadPromptTemplates(paths: string[]): PromptTemplate[] {
  const nameMap = new Map<string, PromptTemplate>();

  for (const dir of paths) {
    if (!existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isFile() && extname(entry) === ".md") {
        let raw: string;
        try {
          raw = readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }
        const { frontmatter, content } = parseFrontmatter(raw);
        const name = frontmatter.name ?? basename(entry, ".md");
        nameMap.set(name, {
          name,
          description: frontmatter.description,
          content,
          path: fullPath,
        });
      }
    }
  }

  return [...nameMap.values()];
}

// ---------------------------------------------------------------------------
// renderPromptTemplate
// ---------------------------------------------------------------------------

export function renderPromptTemplate(
  template: PromptTemplate,
  variables: Record<string, string>,
): string {
  let result = template.content;

  // Handle {{ arguments }} / {{ args }} first
  const args = variables.arguments ?? variables.args ?? "";

  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${_escapeRegex(key)}\\s*\\}\\}`, "g"), value);
  }

  // Replace remaining unmatched {{ placeholders }} with empty string
  result = result.replace(/\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/g, "");

  return result;
}

// ---------------------------------------------------------------------------
// expandTemplateInvocation
// ---------------------------------------------------------------------------

export function expandTemplateInvocation(
  text: string,
  templates: PromptTemplate[],
): string | null {
  const match = text.match(/^\/(\S+)\s*(.*)$/s);
  if (!match) return null;

  const templateName = match[1]!;
  const args = (match[2] ?? "").trim();

  const template = templates.find((t) => t.name === templateName);
  if (!template) return null;

  const hasArguments = /\{\{\s*(?:arguments|args)\s*\}\}/.test(template.content);

  if (hasArguments) {
    return renderPromptTemplate(template, { arguments: args, args });
  }

  // Template has no {{ arguments }} — append args after content
  let result = template.content;
  if (args) {
    result += `\n\n${args}`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
