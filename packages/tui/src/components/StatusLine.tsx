import { useState, useEffect } from "react";

const SPINNER_FRAMES = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];

export function StatusLine({ activity, running }: { activity: string; running: boolean }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setFrame((f: number) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [running]);

  return (
    <box height={1} paddingLeft={1} backgroundColor="#0d0d1a">
      {running || activity ? (
        <text>
          {running && <span fg="#7c8aff">{SPINNER_FRAMES[frame]} </span>}
          <span fg="#585d6b">{activity}</span>
        </text>
      ) : (
        <text />
      )}
    </box>
  );
}
