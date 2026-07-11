import type { ChatItem } from "../types.ts";

const ROLE_STYLES: Record<string, { fg: string; icon: string }> = {
  user: { fg: "#00d7ff", icon: "\u2192" },
  assistant: { fg: "#00ff87", icon: "\u2190" },
  tool: { fg: "#ffd700", icon: "  " },
  thinking: { fg: "#ff00ff", icon: "\ud83d\udcad" },
  error: { fg: "#ff0000", icon: "\u2717" },
  status: { fg: "#888888", icon: "\u2022" },
};

export function ChatItem({ item }: { item: ChatItem }) {
  const style = ROLE_STYLES[item.role] ?? { fg: "#ffffff", icon: " " };
  const dim = item.role === "thinking" || item.role === "tool" || item.role === "status";

  return (
    <box flexDirection="column" marginBottom={item.role === "tool" ? 0 : 1}>
      {item.text.split("\n").map((line, i) => (
        <text key={i}>
          <span fg={style.fg}>
            {dim ? <em>{style.icon} {line}</em> : <>{style.icon} {line}</>}
          </span>
        </text>
      ))}
    </box>
  );
}
