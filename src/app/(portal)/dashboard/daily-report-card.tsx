"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type DailyReportData, type DailyReportPhoto, validateWorkPhoto } from "@/modules/attendance/daily-report";
import { saveDailyReport } from "./report-actions";
export function DailyReportCard({ report }: { report: DailyReportData }) {
  const [state, action, saving] = useActionState(saveDailyReport, {});
  const [busy, setBusy] = useState(false),
    [photoMessage, setPhotoMessage] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const router = useRouter();
  const photoPaths = JSON.stringify(report.photos.filter((p) => p.state === "ready").map((p) => p.path));
  useEffect(() => {
    let current = true;
    const paths = JSON.parse(photoPaths) as string[];
    if (!paths.length) {
      setUrls({});
      return;
    }
    createClient()
      .storage.from("attendance-photos")
      .createSignedUrls(paths, 300)
      .then(({ data, error }) => {
        if (!current) return;
        if (error) {
          setPhotoMessage("Photo previews unavailable. Refresh to try again.");
          return;
        }
        setUrls(
          Object.fromEntries((data ?? []).filter((p) => p.path && p.signedUrl).map((p) => [p.path, p.signedUrl])),
        );
      })
      .catch(() => {
        if (current) setPhotoMessage("Photo previews unavailable. Refresh to try again.");
      });
    return () => {
      current = false;
    };
  }, [photoPaths]);
  async function handlePending(photo: DailyReportPhoto, discard: boolean) {
    setBusy(true);
    setPhotoMessage("");
    try {
      const client = createClient();
      if (discard) {
        const prepared = await client.rpc("prepare_daily_photo_discard", { p_id: photo.id });
        if (prepared.error) throw prepared.error;
        const removed = await client.storage.from("attendance-photos").remove([photo.path]);
        if (removed.error) throw removed.error;
      }
      const { error } = await client.rpc(discard ? "cancel_daily_photo" : "finish_daily_photo", { p_id: photo.id });
      if (error) throw error;
      setPhotoMessage(discard ? "Unfinished upload discarded." : "Photo attached.");
      router.refresh();
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : "Could not update photo. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card section daily-report-card">
      <div className="section-title">
        <h2>Tasks performed today</h2>
        <span className="optional-badge">Optional</span>
      </div>
      <p className="stat-note">Add a short work update or a photo. Neither is required to check out.</p>
      <form action={action}>
        <div className="field">
          <label htmlFor="daily-report-summary">Today's work</label>
          <textarea
            id="daily-report-summary"
            name="summary"
            maxLength={4000}
            defaultValue={report.summary}
            placeholder="What did you work on today?"
            disabled={!report.canEdit}
          />
        </div>
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        {state.success && <p role="status">{state.success}</p>}
        <button className="button button-secondary" type="submit" disabled={saving || !report.canEdit}>
          {saving ? "Saving…" : "Save work update"}
        </button>
      </form>
      <form
        className="section"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const file = new FormData(form).get("photo");
          if (!(file instanceof File)) return;
          const issue = validateWorkPhoto(file);
          if (issue) {
            setPhotoMessage(issue);
            return;
          }
          setBusy(true);
          setPhotoMessage("");
          try {
            const client = createClient();
            const reserved = await client.rpc("reserve_daily_photo", {
              p_id: crypto.randomUUID(),
              p_content_type: file.type,
              p_size: file.size,
            });
            if (reserved.error) throw reserved.error;
            const slot = reserved.data as { id: string; path: string };
            const uploaded = await client.storage
              .from("attendance-photos")
              .upload(slot.path, file, { contentType: file.type, upsert: false });
            if (uploaded.error) throw uploaded.error;
            const finished = await client.rpc("finish_daily_photo", { p_id: slot.id });
            if (finished.error) throw finished.error;
            setPhotoMessage("Photo attached.");
            form.reset();
          } catch (error) {
            setPhotoMessage(
              `${error instanceof Error ? error.message : "Photo upload did not finish."} Checkout is still available. Use Finish upload or Discard for any pending photo.`,
            );
          } finally {
            setBusy(false);
            router.refresh();
          }
        }}
      >
        <div className="field">
          <label htmlFor="daily-report-photo">Add photo (optional)</label>
          <input
            id="daily-report-photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || !report.canEdit || report.photos.length >= 5}
          />
          <small className="stat-note">JPEG, PNG or WebP · up to 5 MB each · maximum 5 photos today</small>
        </div>
        <button
          className="button button-secondary"
          disabled={busy || !report.canEdit || report.photos.length >= 5}
          type="submit"
        >
          {busy ? "Updating photo…" : "Add photo"}
        </button>
      </form>
      {photoMessage && (
        <p role="status" className="stat-note">
          {photoMessage}
        </p>
      )}
      {report.photos.length > 0 && (
        <div className="daily-photo-grid">
          {report.photos.map((photo, index) => (
            <div key={photo.id} className="daily-photo">
              {photo.state === "ready" ? (
                urls[photo.path] ? (
                  <Image
                    src={urls[photo.path]}
                    alt={`Work photo ${index + 1}`}
                    width={240}
                    height={160}
                    unoptimized
                    onError={() => setPhotoMessage("Photo link expired or unavailable. Refresh to reload previews.")}
                  />
                ) : (
                  <span className="stat-note">Photo {index + 1} · loading preview</span>
                )
              ) : (
                <>
                  <p>Unfinished photo upload</p>
                  <div className="filters">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || !report.canEdit || photo.state === "discarding"}
                      onClick={() => handlePending(photo, false)}
                    >
                      Finish upload
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || !report.canEdit}
                      onClick={() => handlePending(photo, true)}
                    >
                      Discard
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
