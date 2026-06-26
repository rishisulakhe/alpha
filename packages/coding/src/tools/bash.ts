import type { AgentToolResult } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import * as path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024;

export function createBashTool(cwd: string): CodingTool {
  return {
    name: "bash",
    description: "Execute a shell command and capture its output.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        timeout: { type: "number", description: "Maximum execution time in milliseconds. Default: 120000 (2 min)." },
      },
      required: ["command"],
    },
    promptSnippet: "bash(command: string, timeout?: number) — Run a shell command.",
    promptGuidelines: "Use bash to run shell commands. Commands run in the project working directory.",
    async execute(args, signal): Promise<AgentToolResult> {
      const command = String(args.command ?? "");
      if (!command) return errorResult("", "bash", "command is required");

      const timeoutMs = typeof args.timeout === "number" && args.timeout > 0
        ? args.timeout
        : 120000;

      // Check cancellation before starting
      if (signal?.isCancelled()) {
        return errorResult("", "bash", "Command cancelled", { exitCode: -1, timedOut: false });
      }

      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn({
          cmd: ["sh", "-c", command],
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult("", "bash", msg);
      }

      let timedOut = false;
      let cancelled = false;

      // Timeout
      const timeoutId = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, timeoutMs)
        : null;

      // Cancellation watcher
      let cancelWatcher: ReturnType<typeof setInterval> | null = null;
      if (signal) {
        cancelWatcher = setInterval(() => {
          if (signal.isCancelled()) {
            cancelled = true;
            proc.kill();
          }
        }, 50);
      }

      try {
        const exitCode = await proc.exited;

        if (timeoutId) clearTimeout(timeoutId);
        if (cancelWatcher) clearInterval(cancelWatcher);

        const stdoutText = await new Response(proc.stdout as unknown as ReadableStream).text();
        const stderrText = await new Response(proc.stderr as unknown as ReadableStream).text();

        let output = stderrText ? `${stdoutText}\n${stderrText}` : stdoutText;

        // Truncate output
        const truncation = _truncateTail(output);
        const content = truncation.content || "(no output)";

        // Write full output to temp log file if truncated
        let logPath: string | undefined;
        if (truncation.truncated) {
          logPath = _writeTempLog(output);
          if (truncation.by === "lines") {
            const startLine = truncation.totalLines - truncation.outputLines + 1;
            return successResult("", "bash",
              `${content}\n\n[Showing lines ${startLine}-${truncation.totalLines} of ${truncation.totalLines}. Full output: ${logPath}]`,
              { exitCode, timedOut, logPath },
            );
          }
          return successResult("", "bash",
            `${content}\n\n[Showing last ${_formatSize(truncation.outputBytes)} of ${_formatSize(truncation.totalBytes)}. Full output: ${logPath}]`,
            { exitCode, timedOut, logPath },
          );
        }

        const ok = exitCode === 0 && !timedOut && !cancelled;
        let finalContent = content;
        if (timedOut) {
          finalContent += `\n\n[Command timed out after ${timeoutMs}ms]`;
        } else if (cancelled) {
          finalContent += "\n\n[Command cancelled]";
        } else if (exitCode !== 0) {
          finalContent += `\n\n[Command exited with code ${exitCode}]`;
        }

        return {
          toolCallId: "",
          name: "bash",
          ok,
          content: finalContent,
          details: { exitCode, timedOut, logPath: logPath ?? null },
        };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (cancelWatcher) clearInterval(cancelWatcher);
        try { proc.kill(); } catch { /* already dead */ }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Truncation helpers
// ---------------------------------------------------------------------------

interface Truncation {
  content: string;
  truncated: boolean;
  by: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
}

function _truncateTail(output: string): Truncation {
  const lines = output.split("\n");
  const totalLines = lines.length;
  const totalBytes = new TextEncoder().encode(output).length;

  if (totalLines <= MAX_OUTPUT_LINES && totalBytes <= MAX_OUTPUT_BYTES) {
    return {
      content: output,
      truncated: false,
      by: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
    };
  }

  // Keep last MAX_OUTPUT_LINES lines
  let kept = lines.slice(-MAX_OUTPUT_LINES);
  let keptBytes = new TextEncoder().encode(kept.join("\n")).length;

  // Byte-limit trim
  if (keptBytes > MAX_OUTPUT_BYTES) {
    const trimLines: string[] = [];
    let bytes = 0;
    for (const line of kept.reverse()) {
      const lb = new TextEncoder().encode((trimLines.length ? "\n" : "") + line).length;
      if (bytes + lb > MAX_OUTPUT_BYTES) break;
      trimLines.unshift(line);
      bytes += lb;
    }
    kept = trimLines;
    keptBytes = bytes;
    return {
      content: kept.join("\n"),
      truncated: true,
      by: "bytes",
      totalLines,
      totalBytes,
      outputLines: kept.length,
      outputBytes: keptBytes,
    };
  }

  return {
    content: kept.join("\n"),
    truncated: true,
    by: "lines",
    totalLines,
    totalBytes,
    outputLines: kept.length,
    outputBytes: keptBytes,
  };
}

function _writeTempLog(output: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "alpha-bash-"));
  const logPath = path.join(dir, "output.log");
  writeFileSync(logPath, output, "utf-8");
  return logPath;
}

function _formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
