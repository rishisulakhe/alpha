import type { ChatItem } from "../types.ts";
import { ToolCard } from "./ToolCard.tsx";

const ROLE_STYLES: Record<string, { fg: string; icon: string }> = {
  user: { fg: "#00d7ff", icon: "\u2192" },
  assistant: { fg: "#00ff87", icon: "\u2190" },
  thinking: { fg: "#cc66ff", icon: "\ud83d\udcad" },
  error: { fg: "#ff4444", icon: "\u2717" },
  status: { fg: "#585d6b", icon: "\u2022" },
};

export function ChatItem({ item }: { item: ChatItem }) {
  if (item.role === "tool") {
    return <ToolCard item={item} />;
  }

  const style = ROLE_STYLES[item.role] ?? { fg: "#c8ccd4", icon: " " };
  const dim = item.role === "thinking" || item.role === "status";

  if (item.role === "thinking" && item.streaming) {
    return (
      <box marginBottom={1}>
        <text>
          <span fg={style.fg}>
            <em>{style.icon} {item.text.slice(-200)}</em>
          </span>
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" marginBottom={1}>
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
