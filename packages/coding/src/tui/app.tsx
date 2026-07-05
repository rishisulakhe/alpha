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
import type { AgentEvent, ToolCall, AgentToolResult } from "@alpha/agent";
import { TuiState, type ChatItem } from "./state.ts";
import { useStreamingBuffer } from "./hooks.ts";
import { CompactInfoBar, ActivityIndicator } from "./sidebar.tsx";

const SCROLL_TICK = 3;

function useScroll(itemCount: number, viewportHeight: number) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);
  const offsetRef = useRef(0);
  const userScrolledRef = useRef(false);

  const maxOffset = Math.max(0, itemCount - viewportHeight);

  useEffect(() => {
    if (!userScrolledRef.current) {
      offsetRef.current = maxOffset;
      setScrollOffset(maxOffset);
    }
  }, [itemCount, viewportHeight, maxOffset]);

  const scrollUp = useCallback((lines = 1) => {
    const next = Math.max(0, offsetRef.current - lines);
    offsetRef.current = next;
    userScrolledRef.current = next < maxOffset;
    setScrollOffset(next);
    setUserScrolled(userScrolledRef.current);
  }, [maxOffset]);

  const scrollDown = useCallback((lines = 1) => {
    const next = Math.min(maxOffset, offsetRef.current + lines);
    offsetRef.current = next;
    userScrolledRef.current = next < maxOffset;
    setScrollOffset(next);
    setUserScrolled(userScrolledRef.current);
  }, [maxOffset]);

  const scrollToBottom = useCallback(() => {
    offsetRef.current = maxOffset;
    userScrolledRef.current = false;
    setScrollOffset(maxOffset);
    setUserScrolled(false);
  }, [maxOffset]);

  return { scrollOffset, userScrolled, scrollUp, scrollDown, scrollToBottom };
}

function useSession() {
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
        const fileName = FsSessionStorage.sessionFileName(cwd);
        const sessionPath = `${dir}/${fileName}`;
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

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "\u2026";
}

function TranscriptView({
  items,
  streamingText,
  running,
  showThinking,
  scrollOffset,
  height,
}: {
  items: ChatItem[];
  streamingText: string;
  running: boolean;
  showThinking: boolean;
  scrollOffset: number;
  height: number;
}) {
  const filtered = showThinking
    ? items
    : items.filter((i) => i.role !== "thinking");

  const visible = filtered.slice(scrollOffset, scrollOffset + height);
  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + height < filtered.length;

  const termWidth = process.stdout.columns ?? 80;
  const maxLen = termWidth - 4;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {hasAbove && (
        <Text dimColor>{"\u2191"} {scrollOffset} lines above</Text>
      )}

      {visible.length === 0 && !running && !streamingText && (
        <Box flexDirection="column">
          <Text dimColor>Welcome to Alpha! Type a prompt to begin.</Text>
          <Text dimColor> </Text>
          <Text dimColor>Commands: /help /model /thinking /compact /quit</Text>
          <Text dimColor>Streaming: Enter/Ctrl+O toggle tools/Esc cancel/Ctrl+D quit</Text>
        </Box>
      )}

      {visible.map((item) => {
        if (item.role === "thinking" && !showThinking) return null;
        const color = roleColor(item.role);
        const icon = roleIcon(item.role);
        const dim = item.role === "thinking" || item.role === "tool" || item.role === "status";

        return (
          <Box key={item.id} flexDirection="column">
            {item.text.split("\n").map((line, li) => (
              <Text key={li} color={color} dimColor={dim}>
                {icon} {truncate(line, maxLen)}
              </Text>
            ))}
          </Box>
        );
      })}

      {streamingText && (
        <Box flexDirection="column">
          {streamingText.split("\n").map((line, li) => (
            <Text key={li} color="green">
              {"\u2190"} {truncate(line, maxLen)}
            </Text>
          ))}
        </Box>
      )}

      {running && !streamingText && items[items.length - 1]?.role !== "tool" && (
        <Box>
          <ActivityIndicator active={true} />
        </Box>
      )}

      {hasBelow && (
        <Text dimColor>{"\u2193"} {filtered.length - scrollOffset - height} lines below</Text>
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
  onScrollUp,
  onScrollDown,
  onScrollToBottom,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  running: boolean;
  isSlashCommand: boolean;
  onScrollUp: (lines?: number) => void;
  onScrollDown: (lines?: number) => void;
  onScrollToBottom: () => void;
}) {
  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit();
        return;
      }

      if (key.upArrow) {
        onScrollUp(SCROLL_TICK);
        return;
      }

      if (key.downArrow) {
        onScrollDown(SCROLL_TICK);
        return;
      }

      if (key.pageUp) {
        onScrollUp(10);
        return;
      }

      if (key.pageDown) {
        onScrollDown(10);
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
    { isActive: !running },
  );

  const color = isSlashCommand ? "yellow" : "green";

  return (
    <Box paddingX={1}>
      <Text color={color} bold>
        {isSlashCommand ? "/" : "\u03c4"}
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

function AlphaTuiApp() {
  const { session, ready, providerName, modelName } = useSession();
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
  const scroll = useScroll(
    state.items.length + (streamBuf.displayText ? 1 : 0),
    transcriptHeight,
  );

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
    },
    { isActive: true },
  );

  // Prompt submission
  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || !session) return;
    setInput("");

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
        if (result.newSessionRequested) {
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
        scrollOffset={scroll.scrollOffset}
        height={transcriptHeight}
      />

      <Text dimColor>{"\u2500".repeat((process.stdout.columns ?? 80) - 2)}</Text>

      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        running={state.running}
        isSlashCommand={input.startsWith("/")}
        onScrollUp={scroll.scrollUp}
        onScrollDown={scroll.scrollDown}
        onScrollToBottom={scroll.scrollToBottom}
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

export function runTuiApp(): void {
  if (!process.stdin.isTTY) {
    console.log("Alpha TUI requires an interactive terminal. Use -p for print mode.");
    console.log("  alpha -p 'your prompt'");
    process.exit(1);
  }
  render(React.createElement(AlphaTuiApp));
}

if (import.meta.main) {
  runTuiApp();
}
