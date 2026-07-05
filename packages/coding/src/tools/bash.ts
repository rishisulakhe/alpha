/**
 * Bash tool for Alpha coding sessions.
 *
 * Executes shell commands with:
 * - Combined stdout/stderr capture
 * - Configurable timeout
 * - Cancellation support
 * - Output truncation with temp file fallback
 * - Process group kill for pipelines
 *
 * Matches Tau's bash tool behavior.
 */

import type { AgentToolResult, CancellationToken } from "@alpha/agent";
import type { CodingTool } from "./types.ts";
import { successResult, errorResult } from "./types.ts";
import { truncateTail, formatSize, DEFAULT_MAX_OUTPUT_LINES, DEFAULT_MAX_OUTPUT_BYTES } from "./truncation.ts";
import * as path from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// createBashTool
// ---------------------------------------------------------------------------

export function createBashTool(cwd: string): CodingTool {
  return {
    name: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_OUTPUT_LINES} lines or ${DEFAULT_MAX_OUTPUT_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
      },
      required: ["command"],
    },
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    promptGuidelines: "",
    async execute(args, signal): Promise<AgentToolResult> {
      const command = String(args.command ?? "");
      const timeout = _optionalFloatArg(args.timeout);

      if (!command) {
        return errorResult("", "bash", "command is required");
      }
      if (timeout !== null && timeout <= 0) {
        return errorResult("", "bash", "timeout must be greater than 0");
      }
      if (signal?.isCancelled()) {
        return errorResult("", "bash", "Command cancelled");
      }

      const startTime = Date.now();

      // Run command
      const { output, exitCode, timedOut, cancelled } = await _runCommand(command, cwd, {
        timeout,
        signal,
      });

      // Truncate output
      const truncation = truncateTail(output);
      const durationSeconds = (Date.now() - startTime) / 1000;

      // Build result
      let outputText = truncation.content || "(no output)";
      const fullOutputPath: string | null = truncation.truncated ? _writeTempOutput(output) : null;

      // Add truncation notice
      if (truncation.truncated && fullOutputPath) {
        const startLine = truncation.totalLines - truncation.outputLines + 1;
        const endLine = truncation.totalLines;

        if (truncation.lastLinePartial) {
          outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine}. Full output: ${fullOutputPath}]`;
        } else if (truncation.truncatedBy === "lines") {
          outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${fullOutputPath}]`;
        } else {
          outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_OUTPUT_BYTES)} limit). Full output: ${fullOutputPath}]`;
        }
      }

      // Add status
      let status: string | null = null;
      if (timedOut) {
        status = timeout ? `Command timed out after ${timeout} seconds` : "Command timed out";
      } else if (cancelled) {
        status = "Command cancelled";
      } else if (exitCode !== 0) {
        status = `Command exited with code ${exitCode}`;
      }

      if (status) {
        outputText = appendStatusBlock(outputText, status);
      }

      const ok = exitCode === 0 && !timedOut && !cancelled;

      return {
        toolCallId: "",
        name: "bash",
        ok,
        content: outputText,
        error: ok ? undefined : status ?? "Command failed",
        data: {
          command,
          exit_code: exitCode,
          timed_out: timedOut,
          cancelled,
          duration_seconds: Math.round(durationSeconds * 1000) / 1000,
          truncation: {
            truncated: truncation.truncated,
            truncated_by: truncation.truncatedBy,
            total_lines: truncation.totalLines,
            output_lines: truncation.outputLines,
            output_bytes: truncation.outputBytes,
          },
          full_output_path: fullOutputPath,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

interface RunOptions {
  timeout?: number | null;
  signal?: CancellationToken | null;
}

interface RunResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
}

async function _runCommand(
  command: string,
  cwd: string,
  opts: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let cancelled = false;
    let finished = false;

    // Spawn in new session for proper process group handling (POSIX)
    // This allows us to kill the entire process group (pipelines, compound commands)
    const proc = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      // @ts-ignore: detached is valid on all platforms
      detached: process.platform !== "win32",
    });

    // Collect stdout and stderr
    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString("utf-8");
    });
    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString("utf-8");
    });

    // Timeout handler
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (opts.timeout) {
      timeoutId = setTimeout(() => {
        if (!finished) {
          timedOut = true;
          _killProcessTree(proc);
        }
      }, opts.timeout * 1000);
    }

    // Cancellation watcher
    let cancelWatcherId: ReturnType<typeof setInterval> | null = null;
    if (opts.signal) {
      cancelWatcherId = setInterval(() => {
        if (opts.signal?.isCancelled() && !finished) {
          cancelled = true;
          _killProcessTree(proc);
        }
      }, 50);
    }

    // Handle completion
    proc.on("close", (code) => {
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (cancelWatcherId) clearInterval(cancelWatcherId);

      resolve({
        output,
        exitCode: code ?? (timedOut || cancelled ? -1 : 0),
        timedOut,
        cancelled,
      });
    });

    proc.on("error", (err) => {
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (cancelWatcherId) clearInterval(cancelWatcherId);

      resolve({
        output: `Failed to spawn command: ${err.message}`,
        exitCode: -1,
        timedOut: false,
        cancelled: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Process killing
// ---------------------------------------------------------------------------

function _killProcessTree(proc: ChildProcess): void {
  if (proc.pid === undefined) return;

  try {
    if (process.platform === "win32") {
      // Windows: use taskkill to kill process tree
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"]);
    } else {
      // POSIX: kill the process group
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // Fallback: kill just the process
        proc.kill("SIGKILL");
      }
    }
  } catch {
    // Process already dead
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _optionalFloatArg(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function appendStatusBlock(text: string, status: string): string {
  return text ? `${text}\n\n${status}` : status;
}

function _writeTempOutput(output: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "alpha-bash-"));
  const logPath = path.join(dir, "output.log");
  try {
    writeFileSync(logPath, output, "utf-8");
    return logPath;
  } catch {
    return "";
  }
}
