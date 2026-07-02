/**
 * Main TUI application for Alpha coding agent.
 *
 * A minimal Ink-based TUI that displays:
 * - Streaming assistant messages
 * - Tool call status and results
 * - Thinking blocks
 * - Error messages
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { InMemorySessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "../session.ts";
import { createProvider } from "../provider.ts";
import type { AgentEvent } from "@alpha/agent";
import { TuiState, type ChatItem } from "./state.ts";
import { TuiEventAdapter } from "./adapter.ts";
import { CompactInfoBar, ActivityIndicator, StatusBar } from "./sidebar.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppStatus {
  provider: string;
  model: string;
  thinking: string;
  tokens: number;
}

// ---------------------------------------------------------------------------
// useScroll hook
// ---------------------------------------------------------------------------

function useScroll(itemCount: number, viewportHeight: number) {
  const [scrollOffset, setScrollOffset] = useState(0);

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    const maxOffset = Math.max(0, itemCount - viewportHeight);
    setScrollOffset(maxOffset);
  }, [itemCount, viewportHeight]);

  const scrollUp = useCallback(() => {
    setScrollOffset((prev) => Math.max(0, prev - 1));
  }, []);

  const scrollDown = useCallback(() => {
    const maxOffset = Math.max(0, itemCount - viewportHeight);
    setScrollOffset((prev) => Math.min(maxOffset, prev + 1));
  }, [itemCount, viewportHeight]);

  return { scrollOffset, scrollUp, scrollDown };
}

// ---------------------------------------------------------------------------
// useAgentSession hook
// ---------------------------------------------------------------------------

function useAgentSession() {
  const sessionRef = useRef<CodingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [providerName, setProviderName] = useState("demo");

  useEffect(() => {
    const { provider, model, providerName: resolvedProviderName } = createProvider();

    const config: CodingSessionConfig = {
      provider,
      model,
      cwd: process.cwd(),
      storage: new InMemorySessionStorage(),
      providerName: resolvedProviderName,
    };
    CodingSession.load(config).then((s) => {
      sessionRef.current = s;
      setProviderName(resolvedProviderName);
      setReady(true);
    });
  }, []);

  return { session: sessionRef.current, ready, providerName };
}

// ---------------------------------------------------------------------------
// TranscriptView component
// ---------------------------------------------------------------------------

function TranscriptView({
  items,
  assistantBuffer,
  running,
  scrollOffset,
  height,
}: {
  items: ChatItem[];
  assistantBuffer: string;
  running: boolean;
  scrollOffset: number;
  height: number;
}) {
  // Calculate visible items based on scroll position
  const visibleItems = items.slice(scrollOffset, scrollOffset + height);

  // Show scroll indicator if there are more items
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + height < items.length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Scroll indicator */}
      {hasMoreAbove && (
        <Text dimColor>↑ {scrollOffset} more above</Text>
      )}

      {visibleItems.length === 0 && !running ? (
        <Box flexDirection="column">
          <Text dimColor>Welcome to Alpha! Type a prompt to begin.</Text>
          <Text dimColor> </Text>
          <Text dimColor>Commands: /help /quit /session /model /thinking</Text>
          <Text dimColor>Shell: !command (add to context) or !!command (hidden)</Text>
        </Box>
      ) : (
        visibleItems.map((item) => (
          <ChatItemView key={item.id} item={item} />
        ))
      )}

      {/* Show assistant buffer while streaming */}
      {assistantBuffer && (
        <Box flexDirection="column">
          <Text color="green">
            {"← "}
            {assistantBuffer}
          </Text>
        </Box>
      )}

      {/* Activity indicator */}
      {running && !assistantBuffer && items[items.length - 1]?.role !== "tool" && (
        <Box>
          <ActivityIndicator active={running} />
        </Box>
      )}

      {/* Scroll indicator */}
      {hasMoreBelow && (
        <Text dimColor>↓ {items.length - scrollOffset - height} more below</Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// ChatItemView component
// ---------------------------------------------------------------------------

function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.role) {
    case "user":
      return (
        <Box flexDirection="column">
          <Text color="cyan">{`→ ${item.text}`}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box flexDirection="column">
          <Text color="green">{`← ${item.text}`}</Text>
        </Box>
      );

    case "thinking":
      return (
        <Box flexDirection="column">
          <Text color="magenta" dimColor italic>
            {item.collapsed ? "💭 " : ""}
            {item.text.slice(0, 200)}
            {item.text.length > 200 ? "…" : ""}
          </Text>
        </Box>
      );

    case "tool":
      return (
        <Box flexDirection="column">
          <Text color="yellow" dimColor>
            {`⚙ ${item.text}`}
          </Text>
        </Box>
      );

    case "error":
      return (
        <Box flexDirection="column">
          <Text color="red" bold>
            {`✗ ${item.text}`}
          </Text>
        </Box>
      );

    case "status":
      return (
        <Box flexDirection="column">
          <Text dimColor>{`• ${item.text}`}</Text>
        </Box>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// PromptInput component
// ---------------------------------------------------------------------------

function PromptInput({
  value,
  onChange,
  onSubmit,
  running,
  isSlashCommand,
  isTerminalCommand,
  onScrollUp,
  onScrollDown,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  running: boolean;
  isSlashCommand: boolean;
  isTerminalCommand: boolean;
  onScrollUp: () => void;
  onScrollDown: () => void;
}) {
  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit();
        return;
      }

      // Handle scrolling
      if (key.upArrow) {
        onScrollUp();
        return;
      }

      if (key.downArrow) {
        onScrollDown();
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      // Handle character input
      if (!key.ctrl && !key.meta && input.length === 1) {
        onChange(value + input);
      }
    },
    { isActive: !running },
  );

  const promptSymbol = isSlashCommand ? "⌘" : isTerminalCommand ? "!" : "τ";

  return (
    <Box paddingX={1}>
      <Text color={isSlashCommand ? "yellow" : isTerminalCommand ? "blue" : "green"} bold>
        {promptSymbol}
        {" "}
      </Text>
      <Text>{value}</Text>
      {!running && <Text dimColor>█</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// AlphaTuiApp main component
// ---------------------------------------------------------------------------

function AlphaTuiApp() {
  const { session, ready, providerName } = useAgentSession();
  const { exit } = useApp();

  // Use TuiState for managing display state
  const stateRef = useRef(new TuiState());
  const [, forceUpdate] = useState({});

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AppStatus>({
    provider: "loading",
    model: "loading",
    thinking: "medium",
    tokens: 0,
  });

  const isSlashCommand = input.startsWith("/");
  const isTerminalCommand = input.startsWith("!");

  // Force re-render helper
  const refresh = useCallback(() => forceUpdate({}), []);

  // Calculate viewport height for transcript
  const termHeight = process.stdout.rows ?? 24;
  const transcriptHeight = Math.max(5, termHeight - 8); // Reserve space for header, dividers, prompt, status

  // Scroll handling
  const { scrollOffset, scrollUp, scrollDown } = useScroll(
    stateRef.current.items.length,
    transcriptHeight,
  );

  // Update status when session is ready
  useEffect(() => {
    if (session) {
      setStatus({
        provider: providerName,
        model: session.model,
        thinking: session.thinkingLevel,
        tokens: session.contextTokenEstimate,
      });
    }
  }, [session, providerName]);

  // Global keybindings (work even when running)
  useInput(
    (input, key) => {
      // Escape cancels running operation
      if (key.escape) {
        if (stateRef.current.running && session) {
          session.cancel();
          stateRef.current.addStatus("Cancelled.");
          refresh();
        }
        return;
      }

      // Ctrl+C or Ctrl+D exits
      if (key.ctrl && (input === "c" || input === "d")) {
        exit();
        return;
      }
    },
    { isActive: stateRef.current.running },
  );

  // Handle prompt submission
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !session) return;

    const text = input.trim();
    setInput("");

    const state = stateRef.current;

    // Handle slash commands locally
    if (text.startsWith("/")) {
      const cmd = text.split(/\s+/)[0]?.toLowerCase();

      if (cmd === "/quit" || cmd === "/exit") {
        state.addStatus("Goodbye!");
        refresh();
        setTimeout(() => exit(), 500);
        return;
      }

      if (cmd === "/help") {
        state.addStatus("Commands: /quit /help /session /model /thinking /clear");
        refresh();
        return;
      }

      if (cmd === "/session") {
        state.addStatus(
          `Session: ${session.sessionId?.slice(0, 16) ?? "none"} | Model: ${session.model} | Tokens: ~${session.contextTokenEstimate}`,
        );
        refresh();
        return;
      }

      if (cmd === "/clear") {
        state.clear();
        refresh();
        return;
      }

      if (cmd === "/model") {
        state.addStatus(`Current model: ${session.model}`);
        refresh();
        return;
      }

      if (cmd === "/thinking") {
        state.addStatus(`Thinking level: ${session.thinkingLevel}`);
        refresh();
        return;
      }
    }

    // Handle terminal commands
    if (text.startsWith("!!")) {
      state.addStatus(`[shell] ${text.slice(2)} (hidden, not added to context)`);
      refresh();
      return;
    }

    if (text.startsWith("!")) {
      state.addStatus(`[shell] ${text.slice(1)} (would run in terminal)`);
      refresh();
      return;
    }

    // Create adapter for this run
    const adapter = new TuiEventAdapter(state);

    // Run the prompt
    state.running = true;
    state.addUserMessage(text);
    refresh();

    try {
      for await (const event of session.prompt(text)) {
        adapter.apply(event);
        refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.addError(message);
      refresh();
    }

    state.running = false;

    // Update token count
    setStatus((prev) => ({ ...prev, tokens: session.contextTokenEstimate }));
    refresh();
  }, [input, session, refresh, exit]);

  if (!ready) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Loading Alpha...</Text>
      </Box>
    );
  }

  const state = stateRef.current;

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      {/* Top status bar */}
      <CompactInfoBar
        provider={status.provider}
        model={status.model}
        tokens={status.tokens}
        thinkingLevel={status.thinking}
      />

      {/* Divider */}
      <Text dimColor>{"─".repeat((process.stdout.columns ?? 80) - 2)}</Text>

      {/* Main transcript area */}
      <TranscriptView
        items={state.items}
        assistantBuffer={state.assistantBuffer}
        running={state.running}
        scrollOffset={scrollOffset}
        height={transcriptHeight}
      />

      {/* Divider */}
      <Text dimColor>{"─".repeat((process.stdout.columns ?? 80) - 2)}</Text>

      {/* Prompt input */}
      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        running={state.running}
        isSlashCommand={isSlashCommand}
        isTerminalCommand={isTerminalCommand}
        onScrollUp={scrollUp}
        onScrollDown={scrollDown}
      />

      {/* Bottom status */}
      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Box>
          {state.running && <ActivityIndicator active={true} />}
        </Box>
        <Text dimColor>
          tokens: ~{status.tokens} | Esc: cancel | Ctrl+D: quit
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
    console.log("Alpha TUI requires an interactive terminal. Use -p for print mode instead.");
    console.log("  alpha -p 'your prompt'        Non-interactive print mode");
    process.exit(1);
  }
  render(React.createElement(AlphaTuiApp));
}

if (import.meta.main) {
  runTuiApp();
}
