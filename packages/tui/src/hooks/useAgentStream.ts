import { useState, useRef, useCallback, useEffect } from "react";
import type { AgentEvent } from "@alpha/agent";
import { TranscriptState, applyEvent } from "../state/transcript.ts";

const FLUSH_INTERVAL_MS = 50;

export function useAgentStream() {
  const stateRef = useRef(new TranscriptState());
  const [, forceUpdate] = useState(0);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    forceUpdate((n) => n + 1);
  }, []);

  const processEvents = useCallback(
    async (events: AsyncIterable<AgentEvent>) => {
      stateRef.current.clear();
      stateRef.current.running = true;
      setRunning(true);
      refresh();

      timerRef.current = setInterval(() => {
        refresh();
      }, FLUSH_INTERVAL_MS);

      try {
        for await (const event of events) {
          applyEvent(stateRef.current, event);

          if (event.type === "tool_execution_start" && event.call) {
            setActivity(`Running ${event.call.name}...`);
          } else if (event.type === "tool_execution_end") {
            setActivity("");
          } else if (event.type === "thinking_delta") {
            setActivity("Thinking...");
          } else if (event.type === "agent_end") {
            setActivity("Completed");
          }
        }
      } catch (err) {
        stateRef.current.running = false;
        setRunning(false);
        applyEvent(stateRef.current, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          recoverable: false,
        } as AgentEvent);
        refresh();
      }

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stateRef.current.running = false;
      setRunning(false);
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    state: stateRef.current,
    running,
    activity,
    refresh,
    processEvents,
  };
}
