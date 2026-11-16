import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { automationStore } from "@/modules/crm/automation/store";
import { CollectionForm } from "./collection-form";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Secure document upload",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Collect({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const db = automationStore();
  const { data: link, error } = await db
    .from("crm_collection_links")
    .select("document_id,expires_at,completed_at")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (error || !link || Date.parse(link.expires_at) < Date.now()) notFound();
  const { data: document } = await db.from("crm_documents").select("title").eq("id", link.document_id).single();
  const { result } = await searchParams;
  return (
    <main className="public-upload-page">
      <section className="card public-upload-card">
        <p className="eyebrow">PSB & Associates LLP</p>
        <h1>Secure document upload</h1>
        <h2>{document?.title}</h2>
        {link.completed_at ? (
          <p role="status">
            Document received. Our team will review it. Receipt does not mean verification is complete.
          </p>
        ) : (
          <>
            <p>PDF, JPEG, PNG, DOCX or XLSX · maximum 4 MB. This private link accepts one document.</p>
            {result === "error" && (
              <p role="alert">Upload failed. Retry with the same file, or contact the firm for a new link.</p>
            )}
            {result === "too-large" && <p role="alert">Choose a file that is 4 MB or smaller.</p>}
            <CollectionForm token={token} />
          </>
        )}
      </section>
    </main>
  );
}
