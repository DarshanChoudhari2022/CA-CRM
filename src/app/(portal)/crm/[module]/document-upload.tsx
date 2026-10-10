"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function DocumentUpload({
  id,
  organizationId,
  storagePath,
}: {
  id: string;
  organizationId: string;
  storagePath?: string;
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setMessage("");
          const file = new FormData(event.currentTarget).get("file");
          try {
            if (!(file instanceof File) || file.size > 10485760) throw new Error("Choose a file up to 10 MB.");
            const path = `${organizationId}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            const client = createClient();
            const { error } = await client.storage.from("crm-documents").upload(path, file);
            if (error) throw error;
            const { error: linkError } = await client.rpc("crm_attach_document", { p_id: id, p_path: path });
            if (linkError) throw linkError;
            setMessage("Document received. Review is still required.");
            router.refresh();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Upload failed.");
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="field">
          <label>
            Upload PDF, image, DOCX or XLSX
            <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" required />
          </label>
        </div>
        <button className="button button-secondary" type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload document"}
        </button>
      </form>
      {storagePath && (
        <button
          className="button button-secondary"
          type="button"
          onClick={async () => {
            const { data, error } = await createClient().storage.from("crm-documents").createSignedUrl(storagePath, 60);
            if (error) setMessage("Download unavailable.");
            else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
          }}
        >
          Download securely
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
