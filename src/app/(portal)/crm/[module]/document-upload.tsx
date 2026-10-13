"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type DocumentVersion, documentType } from "@/modules/crm/documents";

export function DocumentUpload({
  id,
  versions,
  userId,
  admin,
  storagePath,
}: {
  id: string;
  versions: DocumentVersion[];
  userId: string;
  admin: boolean;
  storagePath?: string;
}) {
  const [message, setMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const run = async (action: () => Promise<string>) => {
    setPending(true);
    setMessage("");
    try {
      setMessage(await action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please retry.");
    } finally {
      setPending(false);
      router.refresh();
    }
  };
  const download = (path: string) =>
    run(async () => {
      const result = await createClient().storage.from("crm-documents").createSignedUrl(path, 60);
      if (result.error) throw new Error("Download unavailable. Check access and retry.");
      setDownloadUrl(result.data.signedUrl);
      window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
      return "Secure download opened.";
    });
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const file = new FormData(form).get("file");
          void run(async () => {
            if (!(file instanceof File)) throw new Error("Choose a file.");
            const type = documentType(file.name, file.size);
            const client = createClient();
            const reservation = await client.rpc("crm_reserve_document", {
              p_id: crypto.randomUUID(),
              p_document: id,
              p_filename: file.name.slice(0, 160),
              p_type: type,
              p_size: file.size,
            });
            if (reservation.error) throw reservation.error;
            const upload = await client.storage
              .from("crm-documents")
              .upload(reservation.data.path, file, { contentType: type });
            if (upload.error)
              throw new Error(
                "Upload did not finish. Use Finish upload or Discard below to recover the reserved slot.",
              );
            const finish = await client.rpc("crm_finish_document", { p_id: reservation.data.id });
            if (finish.error) throw new Error("File uploaded but not attached yet. Use Finish upload below.");
            form.reset();
            return `Version ${reservation.data.version} received. Document review is still required.`;
          });
        }}
      >
        <div className="field">
          <label>
            Upload a new version
            <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" required disabled={pending} />
          </label>
        </div>
        <p className="stat-note">Up to 10 MB per file and 10 retained versions. Previous versions stay available.</p>
        <button className="button button-secondary" type="submit" disabled={pending || versions.length >= 10}>
          {pending ? "Working…" : "Upload version"}
        </button>
      </form>
      <div className="document-versions">
        {versions.map((version) => (
          <article key={version.id} className="document-version">
            <div>
              <strong>
                Version {version.version} · {version.filename}
              </strong>
              <small>
                {version.state} · {(version.byte_size / 1024).toFixed(0)} KB ·{" "}
                {new Date(version.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
              </small>
            </div>
            <div className="ai-actions">
              {version.state === "ready" ? (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => void download(version.storage_path)}
                >
                  Download
                </button>
              ) : (
                (admin || version.uploaded_by === userId) && (
                  <>
                    {version.state === "pending" && (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void run(async () => {
                            const result = await createClient().rpc("crm_finish_document", { p_id: version.id });
                            if (result.error) throw result.error;
                            return "Upload finalized.";
                          })
                        }
                      >
                        Finish upload
                      </button>
                    )}
                    <button
                      className="button button-danger"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void run(async () => {
                          const client = createClient();
                          const prepared = await client.rpc("crm_discard_document", {
                            p_id: version.id,
                            p_complete: false,
                          });
                          if (prepared.error) throw prepared.error;
                          const removed = await client.storage.from("crm-documents").remove([version.storage_path]);
                          if (removed.error) throw removed.error;
                          const finished = await client.rpc("crm_discard_document", {
                            p_id: version.id,
                            p_complete: true,
                          });
                          if (finished.error) throw finished.error;
                          return "Unfinished upload discarded and reservation released.";
                        })
                      }
                    >
                      Discard unfinished
                    </button>
                  </>
                )
              )}
            </div>
          </article>
        ))}
      </div>
      {storagePath && !versions.some((version) => version.storage_path === storagePath) && (
        <button
          className="button button-secondary"
          type="button"
          disabled={pending}
          onClick={() => void download(storagePath)}
        >
          Download existing file
        </button>
      )}
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="button button-secondary">
          Open secure file (link valid for 60 seconds)
        </a>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
