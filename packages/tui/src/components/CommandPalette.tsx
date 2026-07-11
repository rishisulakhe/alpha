import { useState, useMemo } from "react";

export interface CommandItem {
  name: string;
  description: string;
  usage: string;
}

const BUILTIN_COMMANDS: CommandItem[] = [
  { name: "help", description: "Show available commands", usage: "/help" },
  { name: "quit", description: "Exit the session", usage: "/quit" },
  { name: "new", description: "Start a new session", usage: "/new" },
  { name: "clear", description: "Clear transcript", usage: "/clear" },
  { name: "compact", description: "Summarize and compact context", usage: "/compact" },
  { name: "model", description: "Choose the active model", usage: "/model [name]" },
  { name: "thinking", description: "Change thinking mode", usage: "/thinking [level]" },
  { name: "session", description: "Show session info", usage: "/session" },
  { name: "resume", description: "Resume a previous session", usage: "/resume [id]" },
  { name: "sessions", description: "List saved sessions", usage: "/sessions" },
  { name: "export", description: "Export session", usage: "/export [dest]" },
  { name: "tree", description: "Branch from previous entry", usage: "/tree" },
  { name: "hotkeys", description: "Show keyboard shortcuts", usage: "/hotkeys" },
  { name: "reload", description: "Reload resources", usage: "/reload" },
];

export function CommandPalette({
  filter,
  onAccept,
  onDismiss,
}: {
  filter: string;
  onAccept: (usage: string) => void;
  onDismiss: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return BUILTIN_COMMANDS.filter(
      (c) =>
        c.name.startsWith(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [filter]);

  const safeIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  return (
    <box flexDirection="column" border paddingLeft={1} paddingRight={1} minHeight={Math.min(8, filtered.length + 2)}>
      <text>
        <span fg="#7c8aff"><strong>Commands</strong></span>
        <span fg="#454b7a"> ({filtered.length})</span>
      </text>
      <text>
        <span fg="#252540">{"\u2500".repeat(30)}</span>
      </text>
      {filtered.slice(0, 8).map((cmd, i) => {
        const sel = i === safeIndex;
        return (
          <text key={cmd.name}>
            <span fg={sel ? "#00ff87" : "#c8ccd4"}>
              {sel ? "▶ " : "  "}
              {cmd.usage}
            </span>
            <span fg={sel ? "#585d6b" : "#454b7a"}>
              {" \u00b7 "}{cmd.description}
            </span>
          </text>
        );
      })}
      {filtered.length === 0 && (
        <text>
          <span fg="#585d6b">No matching commands</span>
        </text>
      )}
    </box>
  );
}
