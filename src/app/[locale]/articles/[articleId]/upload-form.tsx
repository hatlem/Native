"use client";

import { useState } from "react";
import { presignArticleUpload } from "@/app/article-library-actions";
import { saveUploadedDraft } from "@/app/desk-content-actions";

export function UploadForm({
  articleId,
  locale,
  saveDraftAction,
  labels,
}: {
  articleId: string;
  locale: string;
  saveDraftAction: typeof saveUploadedDraft;
  labels: {
    heading: string;
    hint: string;
    uploading: string;
    save: string;
    failed: string;
    unavailable: string;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(f: File | null) {
    setFile(f);
    setKey(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const presigned = await presignArticleUpload({
        articleId,
        locale,
        filename: f.name,
        contentType: f.type,
        bytes: f.size,
      });
      if (!presigned.ok) {
        // Storage isn't configured: no other file would work either, so
        // don't send the user off trying one.
        setError(labels.unavailable);
        return;
      }
      const res = await fetch(presigned.url, {
        method: "PUT",
        body: f,
        headers: { "Content-Type": f.type },
      });
      if (!res.ok) throw new Error(`upload_failed:${res.status}`);
      setKey(presigned.key);
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={`upload-${articleId}`}>{labels.heading}</label>
      <span className="hint">{labels.hint}</span>
      <input
        id={`upload-${articleId}`}
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
      />
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      <form action={saveDraftAction} className="actions" style={{ marginTop: 8 }}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="articleId" value={articleId} />
        <input type="hidden" name="bodyUrl" value={key ?? ""} />
        <button type="submit" disabled={busy || !key} className="btn small secondary">
          {busy ? labels.uploading : labels.save}
        </button>
      </form>
    </div>
  );
}
