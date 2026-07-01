/**
 * Sidebar components for TUI.
 *
 * Provides session information and controls sidebar.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarProps {
  sessionId: string | null;
  cwd: string;
  model: string;
  provider: string;
  tokens: number;
  thinkingLevel: string;
  contextWindow?: number;
  messagesCount: number;
  expanded?: boolean;
  onToggle?: () => void;
}

// ---------------------------------------------------------------------------
// Sidebar Component
// ---------------------------------------------------------------------------

export function Sidebar({
  sessionId,
  cwd,
  model,
  provider,
  tokens,
  thinkingLevel,
  contextWindow = 128000,
  messagesCount,
  expanded = true,
  onToggle,
}: SidebarProps) {
  const tokenPercent = Math.round((tokens / contextWindow) * 100);
  const tokenColor = tokenPercent > 80 ? "red" : tokenPercent > 60 ? "yellow" : "green";

  if (!expanded) {
    return (
      <Box flexDirection="column" width={12} borderStyle="single" borderColor="gray" padding={1}>
        <Box flexDirection="column">
          <Text bold>{provider}</Text>
          <Text dimColor>{model.slice(0, 10)}</Text>
          <Box marginTop={1}>
            <Text color={tokenColor}>{tokenPercent}%</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={32} borderStyle="round" borderColor="gray" padding={1}>
      {/* Session info */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Session
        </Text>
        {sessionId ? (
          <Text dimColor>{sessionId.slice(0, 16)}...</Text>
        ) : (
          <Text dimColor>No session</Text>
        )}
      </Box>

      {/* Working directory */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Working Directory
        </Text>
        <Box flexDirection="column">
          <Text dimColor>{cwd.slice(-40)}</Text>
        </Box>
      </Box>

      {/* Model info */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Provider
        </Text>
        <Text>
          {provider}/{model}
        </Text>
      </Box>

      {/* Context usage */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Context Usage
        </Text>
        <Box>
          <Text color={tokenColor}>
            {tokens.toLocaleString()}
          </Text>
          <Text dimColor>
            /{contextWindow.toLocaleString()} tokens
          </Text>
        </Box>
        <Box>
          <Text dimColor>{messagesCount} messages · {tokenPercent}%</Text>
        </Box>
        {/* Progress bar */}
        <Box>
          <Text dimColor>[</Text>
          <Text color={tokenColor}>
            {"█".repeat(Math.floor(tokenPercent / 5))}
          </Text>
          <Text dimColor>
            {"░".repeat(20 - Math.floor(tokenPercent / 5))}
          </Text>
          <Text dimColor>]</Text>
        </Box>
      </Box>

      {/* Thinking level */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Thinking
        </Text>
        <Text>{thinkingLevel}</Text>
      </Box>

      {/* Keybindings hint */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Keybindings:</Text>
        <Text dimColor>Ctrl+P - Model picker</Text>
        <Text dimColor>Shift+Tab - Thinking cycle</Text>
        <Text dimColor>Esc - Cancel run</Text>
        <Text dimColor>Ctrl+D - Quit</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Compact Info Bar (for top of screen)
// ---------------------------------------------------------------------------

export function CompactInfoBar({
  provider,
  model,
  tokens,
  thinkingLevel,
  contextWindow = 128000,
}: {
  provider: string;
  model: string;
  tokens: number;
  thinkingLevel: string;
  contextWindow?: number;
}) {
  const tokenPercent = Math.round((tokens / contextWindow) * 100);
  const tokenColor = tokenPercent > 80 ? "red" : tokenPercent > 60 ? "yellow" : "green";

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Box>
        <Text bold>{provider}</Text>
        <Text dimColor>:</Text>
        <Text>{model}</Text>
      </Box>
      <Box>
        <Text dimColor>Context:</Text>
        <Text color={tokenColor}>{tokenPercent}%</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Think:</Text>
        <Text>{thinkingLevel}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Activity Indicator
// ---------------------------------------------------------------------------

export function ActivityIndicator({ active }: { active: boolean }) {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⼴", "⠦", "⠧", "⠇", "⠏"];

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 80);

    return () => clearInterval(interval);
  }, [active]);

  if (!active) {
    return <Text dimColor>Ready</Text>;
  }

  return (
    <Box>
      <Text color="cyan">{frames[frame]}</Text>
      <Text dimColor> Working...</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Status Bar
// ---------------------------------------------------------------------------

export function StatusBar({
  message,
  type = "info",
}: {
  message: string;
  type?: "info" | "success" | "error" | "warning";
}) {
  const colorMap: Record<string, string> = {
    info: "blue",
    success: "green",
    error: "red",
    warning: "yellow",
  };
  const color = colorMap[type] ?? "white";

  return (
    <Box paddingX={1}>
      <Text color={color} bold={type === "error"}>{message}</Text>
    </Box>
  );
}
