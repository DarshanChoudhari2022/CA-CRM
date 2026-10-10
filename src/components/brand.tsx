import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <Image src="/brand/ca-india-logo.png" alt="CA India" width={43} height={43} priority />
      {!compact && (
        <div>
          <strong>PSB &amp; Associates LLP</strong>
          <small>Chartered Accountants</small>
        </div>
      )}
    </div>
  );
}
