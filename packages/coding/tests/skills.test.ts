import { describe, expect, test } from "bun:test";
import { loadSkills, expandSkillInvocation, formatSkillsForSystemPrompt } from "../src/resources/skills.ts";
import type { Skill } from "../src/resources/skills.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// === loadSkills ===

describe("loadSkills", () => {
  test("loads .md files from a directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-skills-"));
    const skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(skillsDir, "testing.md"), [
      "---",
      "name: testing",
      "description: A test skill",
      "---",
      "This is the skill content.",
    ].join("\n"));
    try {
      const skills = loadSkills([skillsDir]);
      expect(skills.length).toBe(1);
      expect(skills[0]!.name).toBe("testing");
      expect(skills[0]!.description).toBe("A test skill");
      expect(skills[0]!.content).toBe("This is the skill content.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loads SKILL.md from subdirectories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-skills-sub-"));
    const skillSubDir = path.join(tmpDir, "my-skill");
    fs.mkdirSync(skillSubDir);
    fs.writeFileSync(path.join(skillSubDir, "SKILL.md"), [
      "---",
      "name: my-skill",
      "description: A directory skill",
      "---",
      "Dir skill content.",
    ].join("\n"));
    try {
      const skills = loadSkills([tmpDir]);
      expect(skills.length).toBe(1);
      expect(skills[0]!.name).toBe("my-skill");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips SKILL.md with disableModelInvocation: true", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-skills-disabled-"));
    const skillSubDir = path.join(tmpDir, "disabled-skill");
    fs.mkdirSync(skillSubDir);
    fs.writeFileSync(path.join(skillSubDir, "SKILL.md"), [
      "---",
      "name: disabled",
      "disableModelInvocation: true",
      "---",
      "Should be skipped.",
    ].join("\n"));
    try {
      const skills = loadSkills([tmpDir]);
      expect(skills.length).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("deduplicates by name — later dirs override earlier", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-skills-dedup-"));
    const dir1 = path.join(tmpDir, "user");
    const dir2 = path.join(tmpDir, "project");
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, "skill.md"), "---\nname: shared\n---\nUser version.");
    fs.writeFileSync(path.join(dir2, "skill.md"), "---\nname: shared\n---\nProject version.");
    try {
      const skills = loadSkills([dir1, dir2]); // dir2 loaded last = project wins
      expect(skills.length).toBe(1);
      expect(skills[0]!.content).toBe("Project version.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles empty or missing directories", () => {
    const skills = loadSkills(["/tmp/definitely-nonexistent-dir"]);
    expect(skills).toEqual([]);
  });
});

// === expandSkillInvocation ===

describe("expandSkillInvocation", () => {
  const testSkill: Skill = {
    name: "test-skill",
    description: "A test skill",
    content: "Skill body content.",
    path: "/path/to/test-skill.md",
  };

  test("expands /skill:name into XML block", () => {
    const result = expandSkillInvocation("/skill:test-skill", [testSkill]);
    expect(result).toContain('<skill name="test-skill"');
    expect(result).toContain("Skill body content.");
    expect(result).toContain("</skill>");
  });

  test("includes additional instructions", () => {
    const result = expandSkillInvocation("/skill:test-skill Please do X", [testSkill]);
    expect(result).toContain("Please do X");
  });

  test("returns null for unknown skill", () => {
    expect(expandSkillInvocation("/skill:unknown", [testSkill])).toBeNull();
  });

  test("returns null for non-skill text", () => {
    expect(expandSkillInvocation("Hello world", [testSkill])).toBeNull();
  });

  test("XML-escapes special characters in name and path", () => {
    const skill: Skill = {
      name: "evil<name>",
      description: "desc",
      content: "content",
      path: "/path/evil&evil.md",
    };
    const result = expandSkillInvocation("/skill:evil<name>", [skill]);
    expect(result).not.toContain("<name>"); // escaped
    expect(result).toContain("&lt;name&gt;");
    expect(result).toContain("&amp;");
  });
});

// === formatSkillsForSystemPrompt ===

describe("formatSkillsForSystemPrompt", () => {
  const skills: Skill[] = [
    { name: "testing", description: "Test skill", content: "...", path: "/tmp/testing.md" },
    { name: "linting", description: "Lint skill", content: "...", path: "/tmp/lint.md" },
  ];

  test("generates XML block with all skills", () => {
    const result = formatSkillsForSystemPrompt(skills, true);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("<name>testing</name>");
    expect(result).toContain("<name>linting</name>");
    expect(result).toContain("</available_skills>");
  });

  test("returns empty string when read tool is not available", () => {
    expect(formatSkillsForSystemPrompt(skills, false)).toBe("");
  });

  test("returns empty string for empty skills list", () => {
    expect(formatSkillsForSystemPrompt([], true)).toBe("");
  });

  test("XML-escapes skill metadata", () => {
    const evilSkills: Skill[] = [
      { name: "bad<name>", description: "desc & more", content: "c", path: "/p" },
    ];
    const result = formatSkillsForSystemPrompt(evilSkills, true);
    expect(result).toContain("&lt;name&gt;");
    expect(result).toContain("&amp;");
  });
});
