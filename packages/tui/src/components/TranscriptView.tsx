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
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} backgroundColor="#0d0d1a">
        {filtered.length === 0 && !running && !assistantBuffer && (
          <box flexDirection="column">
            <text>
              <span fg="#585d6b">Welcome to </span>
              <span fg="#7c8aff"><strong>Alpha</strong></span>
              <span fg="#585d6b"> — your coding agent</span>
            </text>
            <text />
            <text>
              <span fg="#454b7a">  Enter</span>
              <span fg="#585d6b"> to run the demo</span>
            </text>
            <text>
              <span fg="#454b7a">  /</span>
              <span fg="#585d6b"> for slash commands</span>
            </text>
            <text>
              <span fg="#454b7a">  Ctrl+T</span>
              <span fg="#585d6b"> toggle thinking</span>
            </text>
            <text>
              <span fg="#454b7a">  Tab</span>
              <span fg="#585d6b"> cycle thinking level</span>
            </text>
            <text>
              <span fg="#454b7a">  Esc</span>
              <span fg="#585d6b"> to exit</span>
            </text>
          </box>
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
            <span fg="#454b7a">Working...</span>
          </text>
        )}
      </box>
    </scrollbox>
  );
}
