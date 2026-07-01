/**
 * Autocomplete system for prompt input.
 *
 * Provides completion suggestions for:
 * - Slash commands
 * - Model names
 * - Skill names
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletionItem {
  id: string;
  label: string;
  description?: string;
  insertText: string;
}

export interface CompletionState {
  items: CompletionItem[];
  selectedIndex: number;
  visible: boolean;
  triggerRange: {
    start: number;
    end: number;
  };
}

// ---------------------------------------------------------------------------
// Slash Command Completions
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: CompletionItem[] = [
  { id: "quit", label: "/quit", description: "Exit the session", insertText: "/quit" },
  { id: "help", label: "/help", description: "Show available commands", insertText: "/help" },
  { id: "new", label: "/new", description: "Start a new session", insertText: "/new" },
  { id: "compact", label: "/compact", description: "Summarize and compact context", insertText: "/compact " },
  { id: "export", label: "/export", description: "Export the session", insertText: "/export " },
  { id: "session", label: "/session", description: "Show session info", insertText: "/session" },
  { id: "reload", label: "/reload", description: "Reload resources", insertText: "/reload" },
  { id: "resume", label: "/resume", description: "Resume previous session", insertText: "/resume " },
  { id: "tree", label: "/tree", description: "Branch from previous entry", insertText: "/tree" },
  { id: "name", label: "/name", description: "Rename session", insertText: "/name " },
  { id: "model", label: "/model", description: "Choose the active model", insertText: "/model" },
  { id: "thinking", label: "/thinking", description: "Change thinking mode", insertText: "/thinking " },
  { id: "login", label: "/login", description: "Save an API key", insertText: "/login " },
  { id: "logout", label: "/logout", description: "Remove saved credentials", insertText: "/logout " },
  { id: "theme", label: "/theme", description: "Set the TUI theme", insertText: "/theme " },
  { id: "hotkeys", label: "/hotkeys", description: "Show keyboard shortcuts", insertText: "/hotkeys" },
];

// ---------------------------------------------------------------------------
// Completion Helpers
// ---------------------------------------------------------------------------

/**
 * Get completions for the current input.
 */
export function getCompletions(
  input: string,
  cursorPosition: number,
  context: {
    models?: string[];
    skills?: string[];
  } = {},
): CompletionState | null {
  // Find if we're in a completable context
  const beforeCursor = input.slice(0, cursorPosition);

  // Slash command completion
  if (beforeCursor.startsWith("/") && !beforeCursor.includes(" ")) {
    const commandPart = beforeCursor.slice(1).toLowerCase();
    const matchingCommands = SLASH_COMMANDS.filter((cmd) =>
      cmd.label.toLowerCase().includes("/" + commandPart) || cmd.id.startsWith(commandPart),
    );

    if (matchingCommands.length > 0) {
      return {
        items: matchingCommands,
        selectedIndex: 0,
        visible: true,
        triggerRange: { start: 0, end: cursorPosition },
      };
    }
  }

  // Model completion for /model command
  const modelMatch = beforeCursor.match(/^\/model\s+(\w*)$/);
  if (modelMatch && context.models) {
    const partialModel = modelMatch[1]!.toLowerCase();
    const matchingModels = context.models
      .filter((m) => m.toLowerCase().includes(partialModel))
      .map((m) => ({
        id: m,
        label: m,
        description: "Model",
        insertText: "/model " + m,
      }));

    if (matchingModels.length > 0) {
      const start = beforeCursor.indexOf(" ") + 1;
      return {
        items: matchingModels,
        selectedIndex: 0,
        visible: true,
        triggerRange: { start, end: cursorPosition },
      };
    }
  }

  // Skill completion for /skill: prefix
  const skillMatch = beforeCursor.match(/^\/skill:(\w*)$/);
  if (skillMatch && context.skills) {
    const partialSkill = skillMatch[1]!.toLowerCase();
    const matchingSkills = context.skills
      .filter((s) => s.toLowerCase().includes(partialSkill))
      .map((s) => ({
        id: s,
        label: s,
        description: "Skill",
        insertText: "/skill:" + s + " ",
      }));

    if (matchingSkills.length > 0) {
      return {
        items: matchingSkills,
        selectedIndex: 0,
        visible: true,
        triggerRange: { start: 0, end: cursorPosition },
      };
    }
  }

  return null;
}

/**
 * Apply a completion to the input.
 */
export function applyCompletion(
  input: string,
  completion: CompletionItem,
  triggerRange: { start: number; end: number },
): { input: string; cursorPosition: number } {
  const before = input.slice(0, triggerRange.start);
  const after = input.slice(triggerRange.end);
  const newInput = before + completion.insertText + after;
  const cursorPosition = before.length + completion.insertText.length;

  return { input: newInput, cursorPosition };
}

// ---------------------------------------------------------------------------
// Completion Suggestions Component
// ---------------------------------------------------------------------------

export function CompletionSuggestions({
  state,
  maxVisible = 10,
}: {
  state: CompletionState;
  maxVisible?: number;
}) {
  if (!state.visible || state.items.length === 0) {
    return null;
  }

  const startIndex = Math.max(0, state.selectedIndex - Math.floor(maxVisible / 2));
  const visibleItems = state.items.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" marginTop={1}>
      <Box paddingX={1}>
        <Text dimColor>Suggestions ({state.items.length})</Text>
      </Box>
      {visibleItems.map((item, idx) => {
        const actualIndex = startIndex + idx;
        const isSelected = actualIndex === state.selectedIndex;

        return (
          <Box key={item.id} flexDirection="row" paddingX={1}>
            <Text color={isSelected ? "green" : undefined} bold={isSelected}>
              {isSelected ? "▶ " : "  "}
              {item.label}
            </Text>
            {item.description && (
              <Text dimColor color={isSelected ? "gray" : undefined}>
                {" "}
                {item.description}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Hook: useCompletion
// ---------------------------------------------------------------------------

export function useCompletion(
  input: string,
  cursorPosition: number,
  context: { models?: string[]; skills?: string[] } = {},
) {
  const [state, setState] = React.useState<CompletionState | null>(null);

  React.useEffect(() => {
    const completionState = getCompletions(input, cursorPosition, context);
    setState(completionState);
  }, [input, cursorPosition, context]);

  const next = React.useCallback(() => {
    if (!state) return;
    setState({
      ...state,
      selectedIndex: (state.selectedIndex + 1) % state.items.length,
    });
  }, [state]);

  const prev = React.useCallback(() => {
    if (!state) return;
    setState({
      ...state,
      selectedIndex: state.selectedIndex === 0 ? state.items.length - 1 : state.selectedIndex - 1,
    });
  }, [state]);

  const accept = React.useCallback(() => {
    if (!state || state.items.length === 0) return null;
    return applyCompletion(input, state.items[state.selectedIndex]!, state.triggerRange);
  }, [state, input]);

  const dismiss = React.useCallback(() => {
    setState(null);
  }, []);

  return {
    state,
    next,
    prev,
    accept,
    dismiss,
    current: state?.items[state.selectedIndex] ?? null,
  };
}
