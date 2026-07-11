import type { ChatItem } from "../types.ts";
import { ChatItem as ChatItemView } from "./ChatItem.tsx";

export function TranscriptView({
  items,
  assistantBuffer,
  running,
  showThinking,
}: {
  items: ChatItem[];
  assistantBuffer: string;
  running: boolean;
  showThinking: boolean;
}) {
  const filtered = showThinking ? items : items.filter((i) => i.role !== "thinking");

  return (
    <scrollbox flexGrow={1}>
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1}>
        {filtered.length === 0 && !running && !assistantBuffer && (
          <text>
            <span fg="#666666">
              Welcome to Alpha! Type a prompt to begin, or press Enter to run the demo.
            </span>
          </text>
        )}

        {filtered.map((item) => (
          <ChatItemView key={item.id} item={item} />
        ))}

        {assistantBuffer && (
          <box marginBottom={1}>
            <text>
              <span fg="#00ff87">← {assistantBuffer}</span>
            </text>
          </box>
        )}

        {running && !assistantBuffer && (
          <text>
            <span fg="#666666">· Working...</span>
          </text>
        )}
      </box>
    </scrollbox>
  );
}
