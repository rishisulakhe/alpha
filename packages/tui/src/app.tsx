import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { TranscriptView } from "./components/TranscriptView.tsx";
import { StatusLine } from "./components/StatusLine.tsx";
import { Footer } from "./components/Footer.tsx";
import { useAgentStream } from "./hooks/useAgentStream.ts";
import { fakeAgentEvents } from "./scripts/fakeEvents.ts";

export function App() {
  const renderer = useRenderer();
  const { height, width } = useTerminalDimensions();
  const { state, running, activity, processEvents } = useAgentStream();
  const [input, setInput] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const [thinkingLevel, setThinkingLevel] = useState("medium");
  const [showThinking, setShowThinking] = useState(true);

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.destroy();
      return;
    }
    if (key.ctrl && key.name === "d") {
      renderer.destroy();
      return;
    }
    if (key.ctrl && key.name === "t") {
      setShowThinking((s) => !s);
      return;
    }
    if (key.name === "return") {
      if (!running) {
        processEvents(fakeAgentEvents());
        setTokenCount(45000);
        setThinkingLevel("medium");
      }
      return;
    }
  });

  return (
    <box flexDirection="column" height="100%">
      <HeaderBar
        provider="openai"
        model="gpt-4.1"
        tokens={tokenCount}
        maxTokens={200000}
        thinking={thinkingLevel}
      />

      <TranscriptView
        items={state.items}
        assistantBuffer={state.assistantBuffer}
        running={running}
        showThinking={showThinking}
      />

      <StatusLine activity={activity} running={running} />

      <box border paddingLeft={1} paddingRight={1} minHeight={3}>
        <text>
          <span fg="#00d7ff">{"> "}</span>
          {input}
        </text>
      </box>

      <Footer
        left={`Enter run demo \u00b7 Ctrl+T toggle thinking \u00b7 Esc exit`}
        right={`${height}x${width} \u00b7 tokens: ~${tokenCount ? (tokenCount / 1000).toFixed(1) + "k" : "0"}`}
      />
    </box>
  );
}
