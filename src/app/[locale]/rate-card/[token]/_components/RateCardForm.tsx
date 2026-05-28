"use client";

import { useState, useTransition } from "react";
import { presignRateCardUpload } from "../actions";

type Title = { titleId: string; name: string; marketCode: string };

export default function RateCardForm({
  token,
  locale,
  titles,
  defaultName,
  defaultEmail,
  unsubscribeHref,
  submitAction,
}: {
  token: string;
  locale: string;
  titles: Title[];
  defaultName: string;
  defaultEmail: string;
  unsubscribeHref: string;
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setObjectKey(null);
    setUploading(true);
    try {
      const { url, key } = await presignRateCardUpload({
        token,
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
      });
      const res = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) throw new Error(`upload_failed_${res.status}`);
      setObjectKey(key);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      action={(fd) => startTransition(() => submitAction(fd))}
      className="mt-6 space-y-6"
      encType="multipart/form-data"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="mediaKitObjectKey" value={objectKey ?? ""} />

      <fieldset className="border rounded p-4">
        <legend className="px-2 text-sm font-medium">Send your rate card</legend>

        <label className="block mb-3">
          <span className="text-sm">Upload a file (PDF / PPTX / image, max 25 MB)</span>
          <input
            type="file"
            accept=".pdf,.pptx,.ppt,.png,.jpg,.jpeg"
            onChange={onFileChange}
            className="block mt-1"
          />
          {uploading && <span className="text-xs text-slate-500">Uploading…</span>}
          {objectKey && <span className="text-xs text-emerald-700">File uploaded.</span>}
          {uploadError && <span className="text-xs text-red-700">Upload failed: {uploadError}</span>}
        </label>

        <label className="block mb-3">
          <span className="text-sm">Or paste a URL to your rate card / media kit</span>
          <input name="mediaKitUrl" type="url" placeholder="https://…" className="block w-full border rounded px-2 py-1 mt-1" />
        </label>

        <details className="mt-2">
          <summary className="cursor-pointer text-sm">Or enter rates per title</summary>
          <table className="w-full text-sm mt-3">
            <thead>
              <tr className="text-left text-slate-500">
                <th>Title</th>
                <th>Price</th>
                <th>Currency</th>
                <th>Unit</th>
                <th>Skip</th>
              </tr>
            </thead>
            <tbody>
              {titles.map((t, i) => (
                <tr key={t.titleId}>
                  <td>
                    {t.name}{" "}
                    <span className="text-slate-500 text-xs">({t.marketCode})</span>
                  </td>
                  <td>
                    <input name={`rates[${i}].titleId`} type="hidden" value={t.titleId} />
                    <input
                      name={`rates[${i}].price`}
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-24 border rounded px-2 py-1"
                    />
                  </td>
                  <td>
                    <select name={`rates[${i}].currency`} className="border rounded px-2 py-1">
                      <option>EUR</option>
                      <option>NOK</option>
                      <option>SEK</option>
                      <option>DKK</option>
                      <option>GBP</option>
                      <option>CHF</option>
                    </select>
                  </td>
                  <td>
                    <select name={`rates[${i}].unit`} className="border rounded px-2 py-1">
                      <option>CPM</option>
                      <option>CPC</option>
                      <option>flat</option>
                    </select>
                  </td>
                  <td>
                    <input name={`rates[${i}].skip`} type="checkbox" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </fieldset>

      <fieldset className="border rounded p-4">
        <legend className="px-2 text-sm font-medium">Native formats you offer</legend>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["native_article", "Native article / advertorial"],
            ["sponsored_content", "Sponsored content"],
            ["brand_stories", "Brand stories"],
            ["video_native", "Native video"],
            ["native_display", "Native display"],
            ["other", "Other"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="checkbox" name="formatsOffered" value={value} /> {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="border rounded p-4">
        <legend className="px-2 text-sm font-medium">Contact for follow-up</legend>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label>
            Name
            <input
              name="contactName"
              defaultValue={defaultName}
              className="w-full border rounded px-2 py-1"
            />
          </label>
          <label>
            Email
            <input
              name="contactEmail"
              type="email"
              defaultValue={defaultEmail}
              className="w-full border rounded px-2 py-1"
            />
          </label>
          <label>
            Role
            <input name="contactRole" className="w-full border rounded px-2 py-1" />
          </label>
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm">Short message (optional)</span>
        <textarea name="responseNote" rows={3} className="w-full border rounded px-2 py-1 mt-1" />
      </label>

      <div className="flex items-center justify-between">
        <button
          type="submit"
          disabled={pending || uploading}
          className="px-4 py-2 bg-slate-900 text-white rounded"
        >
          {pending ? "Sending…" : "Send response"}
        </button>
        <a href={unsubscribeHref} className="text-sm text-slate-500 underline">
          Unsubscribe
        </a>
      </div>
    </form>
  );
}
