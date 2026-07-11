import { useState, useRef, useCallback } from "react";

const MAX_HISTORY = 100;

export function PromptInput({
  running,
  onSubmit,
}: {
  running: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const historyRef = useRef<string[]>([]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text) return;

    if (!running || text.startsWith("/")) {
      historyRef.current.unshift(text);
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.pop();
    }

    onSubmit(text);
    setValue("");
  }, [value, running, onSubmit]);

  const isCommand = value.startsWith("/");

  return (
    <box flexDirection="column">
      <box border paddingLeft={1} paddingRight={1} minHeight={3}>
        <input
          value={value}
          onChange={(v: string) => {
            if (typeof v === "string" && v.includes("\n")) {
              submit();
              return;
            }
            setValue(v);
          }}
          onSubmit={submit}
          focused={!running}
          placeholder={running ? "Steer the agent... (Enter to send)" : "Type a prompt or /command..."}
        />
      </box>
      {isCommand && value.length > 1 && (
        <box paddingLeft={2} marginBottom={1}>
          <text>
            <span fg="#7c8aff">{value}</span>
            <span fg="#454b7a"> — slash command mode</span>
          </text>
        </box>
      )}
    </box>
  );
}
