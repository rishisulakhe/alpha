export function HeaderBar({
  provider,
  model,
  tokens,
  maxTokens,
  thinking,
}: {
  provider: string;
  model: string;
  tokens: number;
  maxTokens: number;
  thinking: string;
}) {
  const pct = maxTokens > 0 ? Math.round((tokens / maxTokens) * 100) : 0;
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const color = pct > 80 ? "#ff0000" : pct > 60 ? "#ffd700" : "#00ff87";

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text>
          <span fg="#00d7ff"><strong>{provider}</strong></span>
          <span fg="#888888">:</span>
          <span fg="#ffffff">{model}</span>
        </text>
        <text>
          <span fg="#888888">Thinking: </span>
          <span fg="#00d7ff">{thinking}</span>
        </text>
      </box>
      <box flexDirection="row" height={1} alignItems="center">
        <text>
          <span fg="#888888">Context: </span>
          <span fg={color}>
            {"\u2588".repeat(filled)}{"\u2591".repeat(barLen - filled)}
          </span>
          <span fg="#888888"> {tokens.toLocaleString()} / {maxTokens.toLocaleString()} ({pct}%)</span>
        </text>
      </box>
      <text><span fg="#333333">{"\u2500".repeat(80)}</span></text>
    </box>
  );
}
