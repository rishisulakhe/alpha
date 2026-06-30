import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, useInput } from "ink";
import { InMemorySessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "../session.ts";
import { createProvider, echoProvider } from "../provider.ts";
import type { AgentEvent } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatBlock {
  id: number;
  role: "user" | "assistant" | "tool" | "thinking" | "error" | "status";
  content: string;
  collapsed?: boolean;
  toolName?: string;
  toolOk?: boolean;
}

interface AppStatus {
  provider: string;
  model: string;
  thinking: string;
  tokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const termColumns = (process.stdout as unknown as { columns?: number }).columns ?? 80;
const termRows = (process.stdout as unknown as { rows?: number }).rows ?? 24;

let _nextId = 1;
function nextId() { return _nextId++; }

// ---------------------------------------------------------------------------
// useAgentSession hook
// ---------------------------------------------------------------------------

function useAgentSession() {
  const sessionRef = useRef<CodingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [providerName, setProviderName] = useState("demo");

  useEffect(() => {
    const provider = createProvider();
    const isReal = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    const model = isReal ? (process.env.ALPHA_MODEL ?? "openai/gpt-4o") : "echo";

    const config: CodingSessionConfig = {
      provider,
      model,
      cwd: process.cwd(),
      storage: new InMemorySessionStorage(),
      providerName: isReal ? "openrouter" : "demo",
    };
    CodingSession.load(config).then((s) => {
      sessionRef.current = s;
      setProviderName(isReal ? "openrouter" : "demo");
      setReady(true);
    });
  }, []);

  return { session: sessionRef.current, ready, providerName };
}

// ---------------------------------------------------------------------------
// AlphaTuiApp
// ---------------------------------------------------------------------------

function AlphaTuiApp() {
  const { session, ready, providerName } = useAgentSession();
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AppStatus>({
    provider: "loading",
    model: "loading",
    thinking: "medium",
    tokens: 0,
  });
  const [running, setRunning] = useState(false);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const sessionRef = useRef(session);
  sessionRef.current = session;

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

  const isSlashCommand = input.startsWith("/");
  const isTerminalCommand = input.startsWith("!");

  const addBlock = useCallback((block: ChatBlock) => {
    setBlocks((prev) => [...prev, block]);
  }, []);

  const updateLastBlock = useCallback((updater: (b: ChatBlock) => ChatBlock) => {
    setBlocks((prev) => {
      const copy = [...prev];
      if (copy.length > 0) {
        copy[copy.length - 1] = updater(copy[copy.length - 1]!);
      }
      return copy;
    });
  }, []);

  // Handle prompt submission
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !sessionRef.current) return;

    const text = input;
    setInput("");
    setRunning(true);

    // Add user message block
    addBlock({ id: nextId(), role: "user", content: text });

    // Handle slash commands locally
    if (text.startsWith("/")) {
      const cmd = text.split(/\s+/)[0];
      if (cmd === "/quit") {
        addBlock({ id: nextId(), role: "status", content: "Goodbye! (press Ctrl+D to exit)" });
        setRunning(false);
        return;
      }
      if (cmd === "/session") {
        const tokens = sessionRef.current.contextTokenEstimate;
        addBlock({ id: nextId(), role: "status", content: `Context: ~${tokens} tokens across ${sessionRef.current.messages.length} messages` });
        setRunning(false);
        return;
      }
      if (cmd === "/thinking") {
        addBlock({ id: nextId(), role: "status", content: `Thinking level: ${status.thinking}` });
        setRunning(false);
        return;
      }
    }

    // Terminal command
    if (text.startsWith("!!")) {
      // Run hidden (no context)
      addBlock({ id: nextId(), role: "status", content: `[shell] ${text.slice(2)} (hidden)` });
      setRunning(false);
      return;
    }
    if (text.startsWith("!")) {
      addBlock({ id: nextId(), role: "status", content: `[shell] ${text.slice(1)}` });
      setRunning(false);
      return;
    }

    try {
      addBlock({ id: nextId(), role: "assistant", content: "" });

      for await (const event of sessionRef.current.prompt(text)) {
        switch (event.type) {
          case "message_delta":
            updateLastBlock((b) => ({ ...b, content: b.content + event.text }));
            break;
          case "thinking_delta":
            addBlock({ id: nextId(), role: "thinking", content: event.text, collapsed: true });
            break;
          case "tool_execution_start":
            if (event.call) {
              addBlock({ id: nextId(), role: "tool", content: `Running: ${event.call.name}...`, toolName: event.call.name });
            }
            break;
          case "tool_execution_end": {
            const result = event.result;
            addBlock({
              id: nextId(),
              role: "tool",
              content: result.content.slice(0, 200),
              toolName: result.name,
              toolOk: result.ok,
            });
            break;
          }
          case "retry":
            addBlock({ id: nextId(), role: "status", content: `Retrying: ${event.message}` });
            break;
          case "error":
            addBlock({ id: nextId(), role: "error", content: `Error: ${event.message}` });
            break;
          case "message_end": {
            // Finalize assistant message
            if (event.message.role === "assistant") {
              updateLastBlock((b) => ({ ...b, content: event.message.content }));
            }
            break;
          }
        }
      }
    } catch (err) {
      addBlock({ id: nextId(), role: "error", content: `Error: ${err instanceof Error ? err.message : String(err)}` });
    }

    setRunning(false);
    // Update token status
    if (sessionRef.current) {
      setStatus((prev) => ({ ...prev, tokens: sessionRef.current!.contextTokenEstimate }));
    }
  }, [input, addBlock, updateLastBlock, status.thinking]);

  // Keybindings
  useInput((_value, key) => {
    if (key.escape) {
      if (running && sessionRef.current) {
        sessionRef.current.cancel();
        setRunning(false);
        addBlock({ id: nextId(), role: "status", content: "Cancelled." });
      }
      return;
    }

    if (key.ctrl && (_value === "c" || _value === "d" || _value === "C")) {
      process.exit(0);
    }

    if (key.return) {
      handleSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (typeof _value === "string" && _value.length === 1 && !key.ctrl && !key.meta) {
      setInput((prev) => prev + _value);
    }
  });

  // Visible messages (last ~15 blocks)
  const visibleBlocks = blocks.slice(-15);

  if (!ready) {
    return <Text>Loading Alpha...</Text>;
  }

  return (
    <Box flexDirection="column" height={termRows}>
      {/* Transcript */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleBlocks.length === 0 && !running ? (
          <Text dimColor>Welcome to Alpha! Type a prompt to begin.</Text>
        ) : (
          visibleBlocks.map((b) => (
            <Box key={b.id} flexDirection="column">
              <Text
                color={
                  b.role === "user" ? "cyan" :
                  b.role === "assistant" ? "green" :
                  b.role === "error" ? "red" :
                  b.role === "thinking" ? "magenta" :
                  b.role === "tool" ? (b.toolOk === false ? "red" : "yellow") :
                  "gray"
                }
                dimColor={b.role === "thinking" || b.role === "tool"}
                italic={b.role === "thinking"}
              >
                {b.role === "user" ? "> " : b.role === "tool" ? `[tool:${b.toolName ?? ""}] ` : b.role === "thinking" ? "[thinking] " : b.role === "error" ? "[error] " : ""}
                {b.content}
              </Text>
            </Box>
          ))
        )}
        {running && (
          <Text color="yellow" dimColor>⌛ Working...</Text>
        )}
      </Box>

      {/* Divider */}
      <Text color="gray">{'─'.repeat(termColumns - 2)}</Text>

      {/* Prompt */}
      <Box paddingX={1} paddingY={0}>
        <Text color={isSlashCommand ? "yellow" : isTerminalCommand ? "blue" : "green"}>
          {isSlashCommand ? "⌘ " : isTerminalCommand ? "! " : "τ "}
        </Text>
        <Text>{input}</Text>
        {!running && <Text color="gray">█</Text>}
      </Box>

      {/* Status bar */}
      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Box>
          <Text dimColor>
            {status.provider}:{status.model} | {status.thinking}
          </Text>
          {running && <Text color="yellow"> ●</Text>}
        </Box>
        <Text dimColor>tokens: ~{status.tokens}</Text>
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
