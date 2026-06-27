import { describe, expect, test } from "bun:test";
import { loadPromptTemplates, renderPromptTemplate, expandTemplateInvocation, type PromptTemplate } from "../src/resources/templates.ts";
import { buildSystemPrompt } from "../src/prompt/system.ts";
import type { CodingTool } from "../src/tools/types.ts";
import type { Skill } from "../src/resources/skills.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// === Step 32: Templates ===

describe("loadPromptTemplates", () => {
  test("loads .md files from directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-tmpl-"));
    fs.writeFileSync(path.join(tmpDir, "review.md"), [
      "---",
      "name: review",
      "description: Review code for bugs",
      "---",
      "Please review the following code for bugs:\n\n{{ arguments }}",
    ].join("\n"));
    try {
      const tmpls = loadPromptTemplates([tmpDir]);
      expect(tmpls.length).toBe(1);
      expect(tmpls[0]!.name).toBe("review");
      expect(tmpls[0]!.description).toBe("Review code for bugs");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("renderPromptTemplate", () => {
  test("substitutes {{ variables }}", () => {
    const tmpl: PromptTemplate = {
      name: "test",
      description: "Test template",
      content: "Hello {{ name }}, welcome to {{ place }}!",
      path: "/tmp/test.md",
    };
    const result = renderPromptTemplate(tmpl, { name: "Alice", place: "Alpha" });
    expect(result).toBe("Hello Alice, welcome to Alpha!");
  });

  test("handles {{ arguments }} as special variable", () => {
    const tmpl: PromptTemplate = {
      name: "review",
      content: "Review: {{ arguments }}",
      path: "/tmp/r.md",
    };
    expect(renderPromptTemplate(tmpl, { arguments: "file.ts" })).toBe("Review: file.ts");
  });

  test("handles {{ args }} as alias for {{ arguments }}", () => {
    const tmpl: PromptTemplate = {
      name: "review",
      content: "Args: {{ args }}",
      path: "/tmp/r.md",
    };
    expect(renderPromptTemplate(tmpl, { args: "my args" })).toBe("Args: my args");
  });

  test("replaces missing variables with empty string", () => {
    const tmpl: PromptTemplate = {
      name: "test",
      content: "Hello {{ missing }}!",
      path: "/tmp/t.md",
    };
    const result = renderPromptTemplate(tmpl, {});
    expect(result).toBe("Hello !");
  });
});

describe("expandTemplateInvocation", () => {
  const reviewTmpl: PromptTemplate = {
    name: "review",
    description: "Review",
    content: "Review: {{ arguments }}",
    path: "/tmp/review.md",
  };
  const simpleTmpl: PromptTemplate = {
    name: "simple",
    description: "Simple",
    content: "Just do something.",
    path: "/tmp/simple.md",
  };

  test("expands /review-template with arguments", () => {
    const result = expandTemplateInvocation("/review src/app.ts", [reviewTmpl]);
    expect(result).toBe("Review: src/app.ts");
  });

  test("appends args when template has no {{ arguments }}", () => {
    const result = expandTemplateInvocation("/simple extra instructions", [simpleTmpl]);
    expect(result).toBe("Just do something.\n\nextra instructions");
  });

  test("returns null for unknown template", () => {
    expect(expandTemplateInvocation("/unknown args", [reviewTmpl])).toBeNull();
  });

  test("returns null for non-template text", () => {
    expect(expandTemplateInvocation("hello world", [reviewTmpl])).toBeNull();
  });
});

// === Step 33: System Prompt ===

function makeReadTool(): CodingTool {
  return {
    name: "read",
    description: "Read a file",
    inputSchema: {},
    promptSnippet: "read(filePath, offset?, limit?) — Read a file from disk.",
    promptGuidelines: "Use read to inspect files before editing.",
    async execute() { return { toolCallId: "", name: "read", ok: true, content: "" }; },
  };
}

function makeWriteTool(): CodingTool {
  return {
    name: "write",
    description: "Write a file",
    inputSchema: {},
    promptSnippet: "write(filePath, content) — Create or overwrite a file.",
    promptGuidelines: "Use write to create or overwrite files.\nCreate parent directories as needed.",
    async execute() { return { toolCallId: "", name: "write", ok: true, content: "" }; },
  };
}

describe("buildSystemPrompt", () => {
  test("default prompt includes tools, guidelines, date, and cwd", () => {
    const result = buildSystemPrompt({
      cwd: "/home/user/project",
      tools: [makeReadTool(), makeWriteTool()],
      skills: [],
    });
    expect(result).toContain("expert coding assistant");
    expect(result).toContain("read(filePath");
    expect(result).toContain("write(filePath");
    expect(result).toContain("Guidelines");
    expect(result).toContain("Current date:");
    expect(result).toContain("/home/user/project");
  });

  test("deduplicates guidelines", () => {
    const tool1 = makeReadTool();
    const tool2: CodingTool = {
      ...makeReadTool(),
      name: "other",
      description: "Other",
      promptGuidelines: "Use read to inspect files before editing.",
    };
    const result = buildSystemPrompt({ cwd: "/tmp", tools: [tool1, tool2], skills: [] });
    const lines = result.split("\n").filter((l) => l.includes("use read to inspect files before editing"));
    // lowercase version:
    const lines2 = result.split("\n").filter((l) => l.toLowerCase().includes("use read to inspect"));
    expect(lines2.length).toBe(1);
  });

  test("custom prompt replaces default intro and tools but keeps append and context", () => {
    const result = buildSystemPrompt({
      cwd: "/tmp",
      tools: [makeReadTool()],
      skills: [],
      customPrompt: "You are a Python specialist.",
      appendPrompt: "Always use type hints.",
      contextFiles: [{ path: "AGENTS.md", content: "Use pytest." }],
    });
    expect(result).toContain("Python specialist");
    expect(result).not.toContain("expert coding assistant");
    expect(result).toContain("Always use type hints.");
    expect(result).toContain("Use pytest.");
    expect(result).toContain("Current date:");
  });

  test("empty custom prompt suppresses default", () => {
    const result = buildSystemPrompt({
      cwd: "/tmp",
      tools: [makeReadTool()],
      skills: [],
      customPrompt: "",
    });
    expect(result).not.toContain("expert coding assistant");
    expect(result).not.toContain("## Available tools");
    expect(result).not.toContain("## Guidelines");
  });

  test("skills index only included when read tool available", () => {
    const skills: Skill[] = [{ name: "test", description: "Test", content: "c", path: "/p" }];
    const withRead = buildSystemPrompt({ cwd: "/tmp", tools: [makeReadTool()], skills });
    const withoutRead = buildSystemPrompt({ cwd: "/tmp", tools: [makeWriteTool()], skills });

    expect(withRead).toContain("<available_skills>");
    expect(withoutRead).not.toContain("<available_skills>");
  });

  test("context files formatted as XML", () => {
    const result = buildSystemPrompt({
      cwd: "/tmp",
      tools: [],
      skills: [],
      contextFiles: [{ path: "PROJECT.md", content: "Important notes." }],
    });
    expect(result).toContain('<context name="PROJECT.md">');
    expect(result).toContain("Important notes.");
    expect(result).toContain("</context>");
  });

  test("extra guidelines appended", () => {
    const result = buildSystemPrompt({
      cwd: "/tmp",
      tools: [makeReadTool()],
      skills: [],
      extraGuidelines: "Be concise.\nUse comments sparingly.",
    });
    const lines = result.split("\n").filter((l) => l.includes("Be concise") || l.includes("Use comments"));
    expect(lines.length).toBe(2);
  });
});
