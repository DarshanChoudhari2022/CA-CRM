"use client";

import { useState } from "react";
import { collectionFileLimit } from "@/modules/crm/documents";

export function CollectionForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form
      className="public-upload-form"
      action={`/api/collect/${token}`}
      method="post"
      encType="multipart/form-data"
      onSubmit={() => setPending(true)}
    >
      <label htmlFor="file">Choose document</label>
      <input
        id="file"
        name="file"
        type="file"
        required
        accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
        onChange={({ currentTarget }) => {
          const file = currentTarget.files?.[0];
          currentTarget.setCustomValidity(
            file && file.size > collectionFileLimit ? "Choose a file that is 4 MB or smaller." : "",
          );
          currentTarget.reportValidity();
        }}
      />
      <div className="public-upload-actions">
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload document"}
        </button>
      </div>
    </form>
  );
}
