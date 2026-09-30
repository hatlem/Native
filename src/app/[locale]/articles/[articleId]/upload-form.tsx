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
    <div className="space-y-2">
      <label className="block text-sm font-medium">{labels.heading}</label>
      <p className="text-xs text-gray-500">{labels.hint}</p>
      <input
        type="file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <form action={saveDraftAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="articleId" value={articleId} />
        <input type="hidden" name="bodyUrl" value={key ?? ""} />
        <button
          type="submit"
          disabled={busy || !key}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? labels.uploading : labels.save}
        </button>
      </form>
    </div>
  );
}
