/**
 * Picker components for TUI interactions.
 *
 * Provides interactive selection dialogs for:
 * - Models
 * - Sessions
 * - Themes
 * - Branch tree
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}

export interface PickerProps {
  title: string;
  items: PickerItem[];
  onSelect: (item: PickerItem) => void;
  onCancel: () => void;
  searchable?: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Picker Component
// ---------------------------------------------------------------------------

export function Picker({
  title,
  items,
  onSelect,
  onCancel,
  searchable = true,
  placeholder = "Type to search...",
}: PickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query),
    );
  }, [items, searchQuery]);

  // Reset selected index when filter changes
  useMemo(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
      return;
    }

    if (key.return && filteredItems.length > 0) {
      onSelect(filteredItems[selectedIndex]!);
      return;
    }

    // Handle search input
    if (searchable && !key.return && !key.escape && !key.upArrow && !key.downArrow) {
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
      } else if (input && input.length === 1) {
        setSearchQuery((prev) => prev + input);
      }
    }
  });

  const maxVisible = 10;
  const startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  const visibleItems = filteredItems.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>

      {searchable && (
        <Box marginBottom={1}>
          <Text dimColor>
            {placeholder}: {searchQuery}
          </Text>
          <Text>_</Text>
        </Box>
      )}

      <Box flexDirection="column" minHeight={10}>
        {visibleItems.length === 0 ? (
          <Text dimColor>No items found</Text>
        ) : (
          visibleItems.map((item, idx) => {
            const actualIndex = startIndex + idx;
            const isSelected = actualIndex === selectedIndex;

            return (
              <Box key={item.id} flexDirection="column">
                <Box>
                  <Text color={isSelected ? "green" : undefined} bold={isSelected}>
                    {isSelected ? "▶ " : "  "}
                    {item.label}
                  </Text>
                </Box>
                {item.description && (
                  <Text dimColor={true}>
                    {"    "}
                    {item.description}
                  </Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ Navigate · Enter Select · Esc Cancel
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Model Picker
// ---------------------------------------------------------------------------

export interface ModelPickerItem extends PickerItem {
  provider: string;
  contextWindow?: number;
}

export function ModelPicker({
  models,
  onSelect,
  onCancel,
}: {
  models: ModelPickerItem[];
  onSelect: (model: ModelPickerItem) => void;
  onCancel: () => void;
}) {
  const items: PickerItem[] = models.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.provider,
    detail: m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k context` : undefined,
  }));

  return (
    <Picker
      title="Select Model"
      items={items}
      onSelect={(item) => {
        const model = models.find((m) => m.id === item.id);
        if (model) onSelect(model);
      }}
      onCancel={onCancel}
    />
  );
}

// ---------------------------------------------------------------------------
// Session Picker
// ---------------------------------------------------------------------------

export interface SessionPickerItem extends PickerItem {
  cwd: string;
  model: string;
  updatedAt: string;
}

export function SessionPicker({
  sessions,
  onSelect,
  onCancel,
}: {
  sessions: SessionPickerItem[];
  onSelect: (session: SessionPickerItem) => void;
  onCancel: () => void;
}) {
  const items: PickerItem[] = sessions.map((s) => ({
    id: s.id,
    label: s.label || s.cwd.split("/").pop() || s.cwd,
    description: `${s.model} · ${s.updatedAt.slice(0, 10)}`,
  }));

  return (
    <Picker
      title="Resume Session"
      items={items}
      onSelect={(item) => {
        const session = sessions.find((s) => s.id === item.id);
        if (session) onSelect(session);
      }}
      onCancel={onCancel}
    />
  );
}

// ---------------------------------------------------------------------------
// Theme Picker
// ---------------------------------------------------------------------------

export const BUILTIN_THEMES = [
  { id: "tau-dark", label: "Tau Dark", description: "Default dark theme" },
  { id: "tau-light", label: "Tau Light", description: "Light theme for bright terminals" },
  { id: "high-contrast", label: "High Contrast", description: "Accessibility-focused high contrast" },
] as const;

export type ThemeId = (typeof BUILTIN_THEMES)[number]["id"];

export function ThemePicker({
  currentTheme,
  onSelect,
  onCancel,
}: {
  currentTheme: ThemeId;
  onSelect: (theme: ThemeId) => void;
  onCancel: () => void;
}) {
  const items: PickerItem[] = BUILTIN_THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.id === currentTheme ? `${t.description} (current)` : t.description,
  }));

  return (
    <Picker
      title="Select Theme"
      items={items}
      onSelect={(item) => onSelect(item.id as ThemeId)}
      onCancel={onCancel}
      searchable={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Tree Picker (Branching)
// ---------------------------------------------------------------------------

export interface TreePickerItem extends PickerItem {
  entryId: string;
  parentId: string | null;
  indent: number;
}

export function TreePicker({
  choices,
  onSelect,
  onCancel,
}: {
  choices: TreePickerItem[];
  onSelect: (choice: TreePickerItem) => void;
  onCancel: () => void;
}) {
  const items: PickerItem[] = choices.map((c) => ({
    ...c,
  }));

  return (
    <Picker
      title="Branch from Entry"
      items={items}
      onSelect={(item) => {
 const choice = choices.find((c) => c.id === item.id);
        if (choice) onSelect(choice);
      }}
      onCancel={onCancel}
      searchable={true}
      placeholder="Search entries..."
    />
  );
}

// ---------------------------------------------------------------------------
// Thinking Level Picker
// ---------------------------------------------------------------------------

export const THINKING_LEVELS = [
  { id: "off", label: "Off", description: "No extended thinking" },
  { id: "minimal", label: "Minimal", description: "Minimal thinking budget" },
  { id: "low", label: "Low", description: "Low thinking budget" },
  { id: "medium", label: "Medium", description: "Default thinking budget" },
  { id: "high", label: "High", description: "High thinking budget" },
  { id: "xhigh", label: "Extra High", description: "Maximum thinking budget" },
] as const;

export function ThinkingPicker({
  currentLevel,
  onSelect,
  onCancel,
}: {
  currentLevel: string;
  onSelect: (level: string) => void;
  onCancel: () => void;
}) {
  const items: PickerItem[] = THINKING_LEVELS.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.id === currentLevel ? `${t.description} (current)` : t.description,
  }));

  return (
    <Picker
      title="Thinking Level"
      items={items}
      onSelect={(item) => onSelect(item.id)}
      onCancel={onCancel}
      searchable={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Confirmation Dialog
// ---------------------------------------------------------------------------

export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "n") {
      onCancel();
      return;
    }
    if (key.return || input.toLowerCase() === "y") {
      onConfirm();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Box marginBottom={1}>
        <Text color="yellow">{message}</Text>
      </Box>
      <Box>
        <Text dimColor>Enter/Y=yes · Esc/N=no</Text>
      </Box>
    </Box>
  );
}
