export function StatusPill({ value }: { value: string }) {
  const tone = /approved|present|full|complete|active/i.test(value)
    ? "green"
    : /pending|late|open|incomplete/i.test(value)
      ? "amber"
      : /rejected|absent|cancel/i.test(value)
        ? "red"
        : "blue";
  return <span className={`status status-${tone}`}>{value.replaceAll("_", " ")}</span>;
}
