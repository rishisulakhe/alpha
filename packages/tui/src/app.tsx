import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { TranscriptView } from "./components/TranscriptView.tsx";
import { StatusLine } from "./components/StatusLine.tsx";
import { Footer } from "./components/Footer.tsx";

export function App() {
  const renderer = useRenderer();
  const { height } = useTerminalDimensions();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.destroy();
      return;
    }
    if (key.ctrl && key.name === "d") {
      renderer.destroy();
    }
  });

  return (
    <box flexDirection="column" height="100%">
      <HeaderBar
        provider="openai"
        model="gpt-4.1"
        tokens={42500}
        maxTokens={200000}
        thinking="medium"
      />

      <TranscriptView />

      <StatusLine activity={running ? "Working..." : ""} running={running} />

      <box border paddingLeft={1} paddingRight={1} minHeight={3}>
        <text>
          <span fg="#00d7ff">{"> "}</span>
          {input}
        </text>
      </box>

      <Footer
        left="Enter send \u00b7 Shift+Enter newline \u00b7 Esc exit"
        right={`${height}x${renderer.width} \u00b7 tokens: ~42.5k`}
      />
    </box>
  );
}
