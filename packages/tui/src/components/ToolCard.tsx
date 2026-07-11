import { useState } from "react";
import type { ChatItem } from "../types.ts";

export function ToolCard({ item }: { item: ChatItem }) {
  const [expanded, setExpanded] = useState(!!item.toolResultText);

  const isOk = item.toolOk;
  const isRunning = item.streaming && !("toolOk" in item) ? undefined : !item.toolOk;

  const borderColor = isOk === true ? "#00ff87" : isOk === false ? "#ff4444" : "#7c8aff";
  const glyph = isOk === true ? "✓" : isOk === false ? "✗" : "⋯";

  return (
    <box flexDirection="column" border paddingLeft={1} paddingRight={1} marginBottom={1} borderColor={borderColor}>
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text>
          <span fg={borderColor}>{glyph} </span>
          <span fg="#ffd700">{item.toolName}</span>
        </text>
        {item.toolResultText && (
          <text>
            <span fg="#585d6b">
              {expanded ? "[collapsed - Ctrl+O to toggle]" : "[expand - Ctrl+O to toggle]"}
            </span>
          </text>
        )}
      </box>
      <text>
        <span fg="#585d6b">{item.text}</span>
      </text>
      {expanded && item.toolResultText && (
        <box marginTop={1} paddingLeft={1}>
          <text>
            <span fg="#888888">
              {item.toolResultText.split("\n").map((l, i) => l).join("\n")}
            </span>
          </text>
        </box>
      )}
    </box>
  );
}

export function DiffViewer({
  filePath,
  oldText,
  newText,
  onClose,
}: {
  filePath: string;
  oldText: string;
  newText: string;
  onClose: () => void;
}) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLines = Math.max(oldLines.length, newLines.length);

  return (
    <box flexDirection="column" border paddingLeft={1} paddingRight={1} marginBottom={1} borderColor="#7c8aff">
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text>
          <span fg="#7c8aff"><strong>Diff: </strong></span>
          <span fg="#c8ccd4">{filePath}</span>
        </text>
        <text>
          <span fg="#ff4444">[Esc to close]</span>
        </text>
      </box>
      <text>
        <span fg="#252540">{"\u2500".repeat(40)}</span>
      </text>
      {Array.from({ length: maxLines }).map((_, i) => {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        const isChanged = oldLine !== newLine;

        return (
          <text key={i}>
            {oldLine != null && (
              <span fg={isChanged ? "#ff4444" : "#585d6b"}>
                {oldLine.padEnd(40).slice(0, 40)}
              </span>
            )}
            {newLine != null && (
              <span fg={isChanged ? "#00ff87" : "#585d6b"}>
                {newLine.padEnd(40).slice(0, 40)}
              </span>
            )}
          </text>
        );
      })}
    </box>
  );
}
