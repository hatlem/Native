"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { presignRateCardUpload } from "../actions";

type Title = { titleId: string; name: string; marketCode: string };

export default function RateCardForm({
  token,
  locale,
  titles,
  defaultName,
  defaultEmail,
  submitAction,
}: {
  token: string;
  locale: string;
  titles: Title[];
  defaultName: string;
  defaultEmail: string;
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("rateCard");
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setObjectKey(null);
    setFileName(file.name);
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

  const formats: Array<[string, string]> = [
    ["native_article", t("format_native_article")],
    ["sponsored_content", t("format_sponsored_content")],
    ["brand_stories", t("format_brand_stories")],
    ["video_native", t("format_video_native")],
    ["native_display", t("format_native_display")],
    ["other", t("format_other")],
  ];

  return (
    <form
      action={(fd) => startTransition(() => submitAction(fd))}
      className="rc-form"
      encType="multipart/form-data"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="mediaKitObjectKey" value={objectKey ?? ""} />

      {/* Send rate card */}
      <section className="card rc-card">
        <h2 className="rc-card-title">{t("sendHeading")}</h2>

        <div className="field">
          <label htmlFor="rc-file">{t("uploadLabel")}</label>
          <label className="rc-file" htmlFor="rc-file">
            <span className="btn secondary small">{t("uploadButton")}</span>
            <span className="rc-file-name">{fileName ?? t("uploadNoFile")}</span>
            <input
              id="rc-file"
              type="file"
              accept=".pdf,.pptx,.ppt,.png,.jpg,.jpeg"
              onChange={onFileChange}
              hidden
            />
          </label>
          <span className="hint">{t("uploadHint")}</span>
          {uploading && <span className="hint">{t("uploading")}</span>}
          {objectKey && <span className="rc-ok">{t("uploadDone")}</span>}
          {uploadError && <span className="err">{t("uploadFailed", { error: uploadError })}</span>}
        </div>

        <div className="rc-or">{t("orSeparator")}</div>

        <div className="field">
          <label htmlFor="rc-url">{t("urlLabel")}</label>
          <input id="rc-url" name="mediaKitUrl" type="url" placeholder={t("urlPlaceholder")} />
        </div>

        <details className="rc-details">
          <summary>{t("ratesLabel")}</summary>
          <div className="rc-rates">
            {titles.map((titleItem, i) => (
              <div className="rc-rate-row" key={titleItem.titleId}>
                <div className="rc-rate-title">
                  {titleItem.name} <span className="muted">({titleItem.marketCode})</span>
                </div>
                <input name={`rates[${i}].titleId`} type="hidden" value={titleItem.titleId} />
                <input
                  name={`rates[${i}].price`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("tablePrice")}
                  className="rc-price"
                  aria-label={`${titleItem.name} ${t("tablePrice")}`}
                />
                <select name={`rates[${i}].currency`} aria-label={t("tableCurrency")}>
                  <option>EUR</option>
                  <option>NOK</option>
                  <option>SEK</option>
                  <option>DKK</option>
                  <option>GBP</option>
                  <option>CHF</option>
                </select>
                <select name={`rates[${i}].unit`} aria-label={t("tableUnit")}>
                  <option>CPM</option>
                  <option>CPC</option>
                  <option>flat</option>
                </select>
                <label className="rc-skip">
                  <input name={`rates[${i}].skip`} type="checkbox" /> {t("tableSkip")}
                </label>
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* Formats */}
      <section className="card rc-card">
        <h2 className="rc-card-title">{t("formatsLabel")}</h2>
        <div className="rc-formats">
          {formats.map(([value, label]) => (
            <label key={value} className="rc-check">
              <input type="checkbox" name="formatsOffered" value={value} /> {label}
            </label>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section className="card rc-card">
        <h2 className="rc-card-title">{t("contactLabel")}</h2>
        <div className="rc-contact-grid">
          <div className="field">
            <label htmlFor="rc-name">{t("contactName")}</label>
            <input id="rc-name" name="contactName" defaultValue={defaultName} />
          </div>
          <div className="field">
            <label htmlFor="rc-email">{t("contactEmail")}</label>
            <input id="rc-email" name="contactEmail" type="email" defaultValue={defaultEmail} />
          </div>
          <div className="field">
            <label htmlFor="rc-role">{t("contactRole")}</label>
            <input id="rc-role" name="contactRole" />
          </div>
        </div>
        <div className="field rc-note">
          <label htmlFor="rc-msg">{t("noteLabel")}</label>
          <textarea id="rc-msg" name="responseNote" rows={3} />
        </div>
      </section>

      <div className="rc-actions">
        <button type="submit" disabled={pending || uploading} className="btn large">
          {pending ? t("sending") : t("submitButton")}
        </button>
      </div>
    </form>
  );
}
