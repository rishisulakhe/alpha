import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/react";
import { useState, useCallback } from "react";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { TranscriptView } from "./components/TranscriptView.tsx";
import { StatusLine } from "./components/StatusLine.tsx";
import { Footer } from "./components/Footer.tsx";
import { PromptInput } from "./components/PromptInput.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { useAgentStream } from "./hooks/useAgentStream.ts";
import { fakeAgentEvents } from "./scripts/fakeEvents.ts";

export function App() {
  const renderer = useRenderer();
  const { height, width } = useTerminalDimensions();
  const { state, running, activity, processEvents } = useAgentStream();
  const [tokenCount, setTokenCount] = useState(0);
  const [thinkingLevel, setThinkingLevel] = useState("medium");
  const [showThinking, setShowThinking] = useState(true);
  const [commandFilter, setCommandFilter] = useState("");

  const handleSubmit = useCallback(
    (text: string) => {
      setCommandFilter("");

      if (text.startsWith("/")) {
        const cmd = text.split(/\s+/)[0]!.toLowerCase();
        if (cmd === "/help" || cmd === "/hotkeys") {
          const buf = "Hotkeys: Enter submit · Shift+Enter newline · / commands · Esc exit · Ctrl+T thinking · Ctrl+O tools · Tab cycle thinking";
          state.addStatus(buf);
          return;
        }
        if (cmd === "/clear") {
          state.clear();
          return;
        }
        if (cmd === "/quit" || cmd === "/exit") {
          state.addStatus("Goodbye!");
          setTimeout(() => renderer.destroy(), 300);
          return;
        }
        if (cmd === "/thinking") {
          const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
          const idx = levels.indexOf(thinkingLevel);
          const next = levels[(idx + 1) % levels.length]!;
          setThinkingLevel(next);
          state.addStatus(`Thinking: ${next}`);
          return;
        }
        state.addStatus(`Unknown command: ${cmd}. Type /help for available commands.`);
        return;
      }

      if (!running) {
        processEvents(fakeAgentEvents());
        setTokenCount(45000);
        setThinkingLevel("medium");
      } else {
        state.addStatus(`Steering: ${text.slice(0, 60)}`);
      }
    },
    [running, thinkingLevel, state, processEvents, renderer],
  );

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (commandFilter) {
        setCommandFilter("");
        return;
      }
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
    if (key.ctrl && key.name === "o") {
      state.showToolResults = !state.showToolResults;
      return;
    }
    if (key.name === "tab" && !commandFilter) {
      const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
      const idx = levels.indexOf(thinkingLevel);
      setThinkingLevel(levels[(idx + 1) % levels.length]!);
      return;
    }
    if (key.name === "return" && !running) {
      processEvents(fakeAgentEvents());
      setTokenCount(45000);
      return;
    }
    if (key.name === "up" && !running) {
      return;
    }
    if (key.name === "down" && !running) {
      return;
    }
  });

  return (
    <box flexDirection="column" height="100%" backgroundColor="#0d0d1a">
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

      {commandFilter ? (
        <CommandPalette
          filter={commandFilter}
          onAccept={(usage) => {
            setCommandFilter("");
            state.addStatus(`Command: ${usage}`);
          }}
          onDismiss={() => setCommandFilter("")}
        />
      ) : (
        <PromptInput running={running} onSubmit={handleSubmit} />
      )}

      <Footer
        left={`Enter send \u00b7 / commands \u00b7 Ctrl+T thinking \u00b7 Esc exit`}
        right={`${height}x${width} \u00b7 tokens: ~${tokenCount ? (tokenCount / 1000).toFixed(1) + "k" : "0"} \u00b7 ${thinkingLevel}`}
      />
    </box>
  );
}
