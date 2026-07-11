export function Footer({
  left,
  right,
}: {
  left: string;
  right: string;
}) {
  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
      <text>
        <span fg="#666666">{left}</span>
      </text>
      <text>
        <span fg="#666666">{right}</span>
      </text>
    </box>
  );
}
