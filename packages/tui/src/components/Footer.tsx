export function Footer({
  left,
  right,
}: {
  left: string;
  right: string;
}) {
  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor="#0d0d1a"
    >
      <text>
        <span fg="#454b7a">{left}</span>
      </text>
      <text>
        <span fg="#454b7a">{right}</span>
      </text>
    </box>
  );
}
