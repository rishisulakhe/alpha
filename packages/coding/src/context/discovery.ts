import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectContextFile {
  path: string;
  content: string;
  source: "home" | "project" | "local";
}

export interface ResourceDiagnostic {
  kind: "skill" | "prompt_template" | "context" | "provider";
  path: string;
  message: string;
  level: "error" | "warning" | "info";
}

// ---------------------------------------------------------------------------
// discoverProjectContext
// ---------------------------------------------------------------------------

const ROOT_MARKERS = [".git", "package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"];

export function discoverProjectContext(cwd: string): ProjectContextFile[] {
  const results: ProjectContextFile[] = [];
  const seen = new Set<string>();
  const home = homedir();

  function addIfExists(filePath: string, source: ProjectContextFile["source"]): void {
    if (!existsSync(filePath)) return;
    try {
      const content = readFileSync(filePath, "utf-8");
      if (!content.trim()) return;
      const hash = createHash("sha256").update(content).digest("hex");
      if (seen.has(hash)) return;
      seen.add(hash);
      results.push({ path: filePath, content, source });
    } catch {
      // Skip unreadable files
    }
  }

  // Home directory
  addIfExists(join(home, ".alpha", "AGENTS.md"), "home");
  addIfExists(join(home, ".agents", "AGENTS.md"), "home");

  // Local (cwd) contexts — run before project so they get priority
  addIfExists(join(cwd, ".alpha", "AGENTS.md"), "local");
  addIfExists(join(cwd, ".agents", "AGENTS.md"), "local");

  // Find project root and add contexts (only if different from cwd)
  const projectRoot = findProjectRoot(cwd);
  if (projectRoot && projectRoot !== cwd) {
    addIfExists(join(projectRoot, "AGENTS.md"), "project");
    addIfExists(join(projectRoot, ".alpha", "AGENTS.md"), "project");
    addIfExists(join(projectRoot, ".agents", "AGENTS.md"), "project");
  } else if (projectRoot) {
    // projectRoot === cwd, add only the root AGENTS.md (not .alpha which was already scanned)
    addIfExists(join(projectRoot, "AGENTS.md"), "project");
  }

  // Sort by priority: local > project > home
  const sourceOrder: Record<string, number> = { home: 0, project: 1, local: 2 };
  results.sort((a, b) => sourceOrder[a.source]! - sourceOrder[b.source]!);

  return results;
}

// ---------------------------------------------------------------------------
// findProjectRoot
// ---------------------------------------------------------------------------

function findProjectRoot(cwd: string): string | null {
  let current = cwd;
  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(join(current, marker))) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
