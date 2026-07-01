import { describe, expect, test } from "bun:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("CLI", () => {
  test("print mode with -p outputs text", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "-p", "Hello world"], {
      cwd: PKG_DIR,
      stdout: "pipe",
      env: {
        ...process.env,
        NVIDIA_API_KEY: "",
        OPENAI_API_KEY: "",
        OPENROUTER_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
    });
    const output = await new Response(proc.stdout).text();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("demo response");
  });

  test("sessions subcommand", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "sessions"], {
      cwd: PKG_DIR,
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output.length).toBeGreaterThan(0);
  });

  test("export subcommand shows message", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "export", "output.html"], {
      cwd: PKG_DIR,
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("Export would write to");
  });

  test("default mode shows TUI placeholder", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts"], {
      cwd: PKG_DIR,
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("TUI not yet implemented");
    expect(output).toContain("Usage:");
  });
});
