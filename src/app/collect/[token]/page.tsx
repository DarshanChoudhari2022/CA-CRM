import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { automationStore } from "@/modules/crm/automation/store";
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
            <p>PDF, JPEG, PNG, DOCX or XLSX · maximum 10 MB. This private link accepts one document.</p>
            {result === "error" && (
              <p role="alert">Upload failed. Retry with the same file, or contact the firm for a new link.</p>
            )}
            <form
              className="public-upload-form"
              action={`/api/collect/${token}`}
              method="post"
              encType="multipart/form-data"
            >
              <label htmlFor="file">Choose document</label>
              <input id="file" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" />
              <div className="public-upload-actions">
                <button className="button button-primary" type="submit">
                  Upload document
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
