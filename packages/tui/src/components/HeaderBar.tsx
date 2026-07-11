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
  const color = pct > 80 ? "#ff4444" : pct > 60 ? "#ffd700" : "#00ff87";

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor="#15152a">
      <box flexDirection="row" justifyContent="space-between" height={1}>
        <text>
          <span fg="#7c8aff"><strong>{provider}</strong></span>
          <span fg="#454b7a">:</span>
          <span fg="#c8ccd4">{model}</span>
        </text>
        <text>
          <span fg="#454b7a">Thinking: </span>
          <span fg="#7c8aff">{thinking}</span>
        </text>
      </box>
      <box flexDirection="row" height={1} alignItems="center">
        <text>
          <span fg="#454b7a">Context: </span>
          <span fg={color}>
            {"\u2588".repeat(filled)}{"\u2591".repeat(barLen - filled)}
          </span>
          <span fg="#585d6b"> {tokens.toLocaleString()} / {maxTokens.toLocaleString()} ({pct}%)</span>
        </text>
      </box>
      <text><span fg="#15152a">{"\u2500".repeat(80)}</span></text>
    </box>
  );
}
