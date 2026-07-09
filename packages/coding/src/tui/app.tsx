/**
 * Alpha TUI — Ink-based terminal UI with smooth streaming.
 *
 * Uses useStreamingBuffer to accumulate text deltas in a ref
 * and flush to React state at ~80ms intervals, avoiding
 * jank from per-delta full re-renders.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { FsSessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "../session.ts";
import { createProvider } from "../provider.ts";
import { getAlphaPaths, projectSessionDir } from "../config/paths.ts";
import { createCodingTools } from "../tools/types.ts";
import { SessionManager } from "../session-manager.ts";
import type { AgentEvent, ToolCall, AgentToolResult } from "@alpha/agent";
import { TuiState, type ChatItem } from "./state.ts";
import { useStreamingBuffer } from "./hooks.ts";
import { CompactInfoBar, ActivityIndicator } from "./sidebar.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";

const SCROLL_TICK = 3;

function useScroll(lineCount: number, viewportHeight: number) {
  const [scrollOffset, setScrollOffset] = useState(0);

  const maxOffset = Math.max(0, lineCount - viewportHeight);

  const scrollUp = useCallback((lines = 1) => {
    setScrollOffset((prev) => Math.min(maxOffset, prev + lines));
  }, [maxOffset]);

  const scrollDown = useCallback((lines = 1) => {
    setScrollOffset((prev) => Math.max(0, prev - lines));
  }, []);

  const scrollToBottom = useCallback(() => {
    setScrollOffset(0);
  }, []);

  const start = Math.max(0, lineCount - viewportHeight - scrollOffset);

  return { start, scrollUp, scrollDown, scrollToBottom };
}

function useSession(opts?: TuiOptions) {
  const sessionRef = useRef<CodingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [providerName, setProviderName] = useState("loading");
  const [modelName, setModelName] = useState("loading");

  useEffect(() => {
    const init = async () => {
      try {
        const { provider, model, providerName: resolvedName } = createProvider();
        const paths = getAlphaPaths();
        const cwd = process.cwd();
        const dir = projectSessionDir(cwd, paths);

        let sessionPath: string;
        let sessionId: string | undefined;

        if (opts?.resume) {
          const manager = new SessionManager(paths);
          const latest = manager.latestSessionForCwd(cwd);
          if (latest) {
            sessionPath = latest.path;
            sessionId = latest.id;
          } else {
            const fileName = FsSessionStorage.sessionFileName(cwd);
            sessionPath = `${dir}/${fileName}`;
          }
        } else {
          const fileName = FsSessionStorage.sessionFileName(cwd);
          sessionPath = `${dir}/${fileName}`;
        }

        const storage = new FsSessionStorage(sessionPath);
        await storage.ensureHeader(cwd);

        const tools = await createCodingTools(cwd);

        const config: CodingSessionConfig = {
          provider,
          model,
          cwd,
          tools,
          storage,
          providerName: resolvedName,
          sessionId,
          sessionManager: new SessionManager(paths),
        };
        const session = await CodingSession.load(config);
        sessionRef.current = session;
        setProviderName(resolvedName);
        setModelName(session.model);
        setReady(true);
      } catch (err) {
        setReady(true);
        setProviderName("error");
        setModelName(String(err));
      }
    };
    init();
  }, []);

  return { session: sessionRef.current, ready, providerName, modelName };
}

function useForceUpdate() {
  const [, setTick] = useState({});
  return useCallback(() => setTick({}), []);
}

// ---------------------------------------------------------------------------
// Transcript rendering
// ---------------------------------------------------------------------------

function roleColor(role: ChatItem["role"]): string | undefined {
  switch (role) {
    case "user": return "cyan";
    case "assistant": return "green";
    case "tool": return "yellow";
    case "thinking": return "magenta";
    case "error": return "red";
    case "status": return undefined;
    default: return undefined;
  }
}

function roleIcon(role: ChatItem["role"]): string {
  switch (role) {
    case "user": return "→";
    case "assistant": return "←";
    case "thinking": return "💭";
    case "tool": return "  ";
    case "error": return "✗";
    case "status": return "•";
    default: return " ";
  }
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [line];
  if (line.length <= maxWidth) return [line];
  const result: string[] = [];
  let remaining = line;
  while (remaining.length > 0) {
    if (remaining.length <= maxWidth) {
      result.push(remaining);
      break;
    }
    const spaceIdx = remaining.lastIndexOf(" ", maxWidth);
    const breakAt = spaceIdx > maxWidth / 2 ? spaceIdx : maxWidth;
    if (breakAt <= 0) {
      result.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    } else {
      result.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
  }
  return result;
}

interface DisplayLine {
  text: string;
  color?: string;
  dim: boolean;
  icon: string;
  key: string;
}

function buildDisplayLines(
  items: ChatItem[],
  streamingText: string,
  showThinking: boolean,
  maxLen: number,
): DisplayLine[] {
  const lines: DisplayLine[] = [];

  for (const item of items) {
    if (item.role === "thinking" && !showThinking) continue;
    const color = roleColor(item.role);
    const icon = roleIcon(item.role);
    const dim = item.role === "thinking" || item.role === "tool" || item.role === "status";

    for (const raw of item.text.split("\n")) {
      const wrapped = wrapLine(raw, maxLen);
      for (const w of wrapped) {
        lines.push({ text: `${icon} ${w}`, color, dim, icon, key: `${item.id}-${lines.length}` });
      }
    }
  }

  if (streamingText) {
    for (const raw of streamingText.split("\n")) {
      const wrapped = wrapLine(raw, maxLen);
      for (const w of wrapped) {
        lines.push({ text: `← ${w}`, color: "green", dim: false, icon: "←", key: `stream-${lines.length}` });
      }
    }
  }

  return lines;
}

function TranscriptView({
  items,
  streamingText,
  running,
  showThinking,
  start,
  height,
}: {
  items: ChatItem[];
  streamingText: string;
  running: boolean;
  showThinking: boolean;
  start: number;
  height: number;
}) {
  const termWidth = process.stdout.columns ?? 80;
  const maxLen = Math.max(10, termWidth - 4);

  const allLines = buildDisplayLines(items, streamingText, showThinking, maxLen);
  const visible = allLines.slice(start, start + height);
  const hasAbove = start > 0;
  const hasBelow = start + height < allLines.length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {hasAbove && (
        <Text dimColor>{"\u2191"} {start} lines above</Text>
      )}

      {visible.length === 0 && !running && !streamingText && (
        <Box flexDirection="column">
          <Text dimColor>Welcome to Alpha! Type a prompt to begin.</Text>
          <Text dimColor> </Text>
          <Text dimColor>Commands: /help /model /thinking /compact /quit</Text>
          <Text dimColor>Streaming: Up/Dn scroll | Esc cancel | Ctrl+D quit</Text>
        </Box>
      )}

      {visible.map((line) => (
        <Text key={line.key} color={line.color} dimColor={line.dim}>
          {line.text}
        </Text>
      ))}

      {running && !streamingText && items[items.length - 1]?.role !== "tool" && (
        <Box>
          <ActivityIndicator active={true} />
        </Box>
      )}

      {hasBelow && (
        <Text dimColor>{"\u2193"} {allLines.length - start - height} lines below</Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Prompt input
// ---------------------------------------------------------------------------

function PromptInput({
  value,
  onChange,
  onSubmit,
  running,
  isSlashCommand,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  running: boolean;
  isSlashCommand: boolean;
}) {
  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit();
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      if (!key.ctrl && !key.meta && input.length === 1) {
        onChange(value + input);
      }
    },
    { isActive: true },
  );

  const color = isSlashCommand ? "yellow" : "green";

  return (
    <Box paddingX={1}>
      <Text color={color} bold>
        {isSlashCommand ? "/" : running ? "\u25b6" : "\u03c4"}
        {" "}
      </Text>
      <Text>{value}</Text>
      {!running && <Text dimColor>{"\u2588"}</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

function AlphaTuiApp({ options }: { options?: TuiOptions }) {
  const { session, ready, providerName, modelName } = useSession(options);
  const { exit } = useApp();
  const forceUpdate = useForceUpdate();

  const stateRef = useRef(new TuiState());
  const streamBuf = useStreamingBuffer();

  const [input, setInput] = useState("");

  // Header status
  const [tokenCount, setTokenCount] = useState(0);
  const [thinkingLevel, setThinkingLevel] = useState("medium");

  const termHeight = process.stdout.rows ?? 24;
  const transcriptHeight = Math.max(5, termHeight - 6);

  const state = stateRef.current;

  const allLines = buildDisplayLines(
    state.items,
    streamBuf.displayText,
    state.showThinking,
    Math.max(10, (process.stdout.columns ?? 80) - 4),
  );

  const scroll = useScroll(allLines.length, transcriptHeight);

  // Sync header info from session
  useEffect(() => {
    if (!session) return;
    setThinkingLevel(session.thinkingLevel);
    setTokenCount(session.contextTokenEstimate);
  }, [session]);

  // Global keybindings (active even when running)
  useInput(
    (input, key) => {
      if (key.escape) {
        if (state.running && session) {
          session.cancel();
          state.addStatus("Cancelled.");
          streamBuf.reset();
          forceUpdate();
        }
        return;
      }

      if (key.ctrl && (input === "c" || input === "d")) {
        exit();
        return;
      }

      if (key.tab && session) {
        const newLevel = session.cycleThinkingLevel();
        setThinkingLevel(newLevel);
        state.addStatus(`Thinking: ${newLevel}`);
        forceUpdate();
        return;
      }

      if (key.ctrl && input === "t") {
        const shown = state.toggleThinking();
        state.addStatus(shown ? "Thinking shown" : "Thinking hidden");
        forceUpdate();
        return;
      }

      if (key.ctrl && input === "o") {
        const shown = state.toggleToolResults();
        state.addStatus(shown ? "Tool results shown" : "Tool results collapsed");
        forceUpdate();
        return;
      }

      if (key.upArrow) {
        scroll.scrollUp(SCROLL_TICK);
        return;
      }

      if (key.downArrow) {
        scroll.scrollDown(SCROLL_TICK);
        return;
      }

      if (key.pageUp) {
        scroll.scrollUp(10);
        return;
      }

      if (key.pageDown) {
        scroll.scrollDown(10);
        return;
      }
    },
    { isActive: true },
  );

  // Prompt submission
  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || !session) return;
    setInput("");

    // Steer when session is already running
    if (session.isRunning) {
      state.addStatus(`Steering: ${text.slice(0, 60)}`);
      forceUpdate();
      try {
        await session.prompt(text, "steer");
      } catch (err) {
        state.addError(String(err));
        forceUpdate();
      }
      return;
    }

    // Slash commands
    if (text.startsWith("/")) {
      const result = session.handleCommand(text);
      if (result.handled) {
        if (result.exitRequested) {
          state.addStatus(result.message ?? "Exiting...");
          forceUpdate();
          setTimeout(() => exit(), 300);
          return;
        }
        if (result.newSessionRequested || result.clearRequested) {
          state.clear();
          await session.newSession();
          state.addStatus("Started new session.");
          forceUpdate();
          return;
        }
        if (result.thinkingLevel) {
          await session.setThinkingLevel(result.thinkingLevel);
          setThinkingLevel(result.thinkingLevel);
          state.addStatus(`Thinking: ${result.thinkingLevel}`);
          forceUpdate();
          return;
        }
        if (result.compactSummary !== undefined) {
          await session.compact(result.compactSummary);
          state.addStatus("Compacted context.");
          setTokenCount(session.contextTokenEstimate);
          forceUpdate();
          return;
        }
        if (result.modelPickerRequested) {
          const models = session.availableModels;
          const lines = ["Available models:"];
          for (const m of models) {
            const marker = m === session.model ? " *" : "  ";
            lines.push(`${marker} ${m}`);
          }
          lines.push("", "Use /model <name> to switch or type a model name.");
          state.addStatus(lines.join("\n"));
          forceUpdate();
          return;
        }
        if (result.resumePickerRequested) {
          state.addStatus("Use /sessions to list saved sessions, then /resume <id> to resume one.");
          forceUpdate();
          return;
        }
        if (result.resumeSessionId) {
          try {
            await session.resume(result.resumeSessionId);
            state.clear();
            state.addStatus(`Resumed session: ${result.resumeSessionId.slice(0, 16)}`);
          } catch (err) {
            state.addError(String(err));
          }
          forceUpdate();
          return;
        }
        if (result.treePickerRequested) {
          try {
            const choices = await session.treeChoices();
            const lines = ["Branch points:"];
            for (const c of choices) {
              lines.push(c.active ? `  * ${c.label}` : `    ${c.label}`);
            }
            lines.push("", "Use /tree <entryId> or /branch <entryId> to branch.");
            state.addStatus(lines.join("\n"));
          } catch (err) {
            state.addError(String(err));
          }
          forceUpdate();
          return;
        }
        if (result.loginPickerRequested || result.loginProvider) {
          state.addStatus(
            "To log in, set the appropriate API key environment variable\n" +
            "(e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY)\n" +
            "or run: alpha setup",
          );
          forceUpdate();
          return;
        }
        if (result.logoutPickerRequested || result.logoutProvider) {
          state.addStatus(
            "To remove credentials, delete the entry from\n" +
            "~/.alpha/credentials.json or unset the API key env var.",
          );
          forceUpdate();
          return;
        }
        if (result.themePickerRequested || result.theme) {
          state.addStatus("Theme switching is not yet available in the TUI.");
          forceUpdate();
          return;
        }
        if (result.scopedModelsPickerRequested) {
          state.addStatus("Scoped models configuration is not yet available in the TUI.");
          forceUpdate();
          return;
        }
        if (result.exportRequested) {
          const msg = await session.applyCommandResult(result);
          if (msg) state.addStatus(msg);
          forceUpdate();
          return;
        }
        const msg = await session.applyCommandResult(result);
        if (msg) state.addStatus(msg);
        setTokenCount(session.contextTokenEstimate);
        forceUpdate();
        return;
      }
    }

    // Terminal commands
    if (text.startsWith("!!")) {
      try {
        const cmdResult = await session.runTerminalCommand(text.slice(2).trim(), false);
        state.addStatus(`[shell] ${cmdResult.command}\n${cmdResult.output.slice(0, 400)}`);
      } catch (err) {
        state.addError(String(err));
      }
      forceUpdate();
      return;
    }

    if (text.startsWith("!")) {
      try {
        const cmdResult = await session.runTerminalCommand(text.slice(1).trim(), true);
        state.addStatus(`[shell] ${cmdResult.command}\n${cmdResult.output.slice(0, 400)}`);
      } catch (err) {
        state.addError(String(err));
      }
      forceUpdate();
      return;
    }

    // Normal prompt
    state.addUserMessage(text);
    state.running = true;
    state.error = null;
    streamBuf.reset();
    streamBuf.startFlushing();
    scroll.scrollToBottom();
    forceUpdate();

    try {
      for await (const event of session.prompt(text)) {
        switch (event.type) {
          case "message_delta":
            streamBuf.append(event.text);
            break;

          case "thinking_delta":
            state.addThinkingDelta(event.text);
            if (state.showThinking) forceUpdate();
            break;

          case "message_end": {
            const msg = event.message;
            if (msg.role === "assistant") {
              const flushed = streamBuf.finalize();
              if (flushed || msg.content) {
                state.addAssistantMessage(msg.content || flushed);
              }
              streamBuf.startFlushing();
              forceUpdate();
            }
            break;
          }

          case "tool_execution_start": {
            const flushed = streamBuf.finalize();
            if (flushed) state.addAssistantMessage(flushed);
            if (event.call) state.addToolCall(event.call);
            streamBuf.startFlushing();
            forceUpdate();
            break;
          }

          case "tool_execution_end":
            state.recordToolResult(event.result);
            forceUpdate();
            break;

          case "retry":
            state.addStatus(`Retrying: ${event.message}`);
            forceUpdate();
            break;

          case "error": {
            const flushed = streamBuf.finalize();
            if (flushed) state.addAssistantMessage(flushed);
            if (event.recoverable && event.message === "Agent run cancelled") {
              state.addStatus("Agent run cancelled.");
            } else {
              state.addError(event.message);
            }
            streamBuf.startFlushing();
            forceUpdate();
            break;
          }

          case "agent_end":
          case "turn_start":
          case "turn_end":
          case "message_start":
          case "queue_update":
            break;
        }
      }
    } catch (err) {
      const flushed = streamBuf.finalize();
      if (flushed) state.addAssistantMessage(flushed);
      state.addError(err instanceof Error ? err.message : String(err));
      forceUpdate();
    } finally {
      const remaining = streamBuf.finalize();
      if (remaining) state.addAssistantMessage(remaining);
      state.running = false;
      setTokenCount(session.contextTokenEstimate);
      scroll.scrollToBottom();
      forceUpdate();
    }
  }, [input, session, state, streamBuf, forceUpdate, scroll, exit]);

  if (!ready) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Loading Alpha...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termHeight}>
      <CompactInfoBar
        provider={providerName}
        model={modelName}
        tokens={tokenCount}
        thinkingLevel={thinkingLevel}
      />

      <Text dimColor>{"\u2500".repeat((process.stdout.columns ?? 80) - 2)}</Text>

      <TranscriptView
        items={state.items}
        streamingText={streamBuf.displayText}
        running={state.running}
        showThinking={state.showThinking}
        start={scroll.start}
        height={transcriptHeight}
      />

      <Text dimColor>{"\u2500".repeat((process.stdout.columns ?? 80) - 2)}</Text>

      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        running={state.running}
        isSlashCommand={input.startsWith("/")}
      />

      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Box>
          {state.running && <ActivityIndicator active={true} />}
        </Box>
        <Text dimColor>
          {state.running
            ? "Esc: cancel | Ctrl+D: quit"
            : `tokens: ~${tokenCount} | Esc: cancel | Ctrl+D: quit`}
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface TuiOptions {
  resume?: boolean;
}

export function runTuiApp(opts?: TuiOptions): void {
  if (!process.stdin.isTTY) {
    console.log("Alpha TUI requires an interactive terminal. Use -p for print mode.");
    console.log("  alpha -p 'your prompt'");
    process.exit(1);
  }
  render(
    React.createElement(
      ErrorBoundary,
      null,
      React.createElement(AlphaTuiApp, { options: opts }),
    ),
  );
}

if (import.meta.main) {
  runTuiApp();
}
