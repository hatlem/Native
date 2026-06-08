"use client";

import { useTranslations } from "next-intl";
import type { Article } from "@/lib/preview/schema";

export type ArticleField = "headline" | "standfirst";

export function PreviewArticle({
  article,
  source,
  brand,
  disclosureLabel,
  photoClass,
  photoUrl,
  onEditField,
  onEditBody,
}: {
  article: Article;
  source: "ai" | "template" | null;
  brand: string;
  disclosureLabel: string;
  photoClass: string;
  photoUrl: string | null;
  onEditField: (field: ArticleField, value: string) => void;
  onEditBody: (index: number, value: string) => void;
}) {
  const t = useTranslations("landing");
  const tag = `● ${disclosureLabel}${brand ? ` · ${brand}` : ""}`;
  return (
    <div className="na-frame">
      <div className="na-bar">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="url">{t("studio.mastheadName").toLowerCase()}.example/sponsored</span>
      </div>
      <div className="na-masthead">
        <span className="na-name">{t("studio.mastheadName")}</span>
        <span className="na-nav">
          <span>{t("studio.navNews")}</span>
          <span>{t("studio.navBusiness")}</span>
          <span>{t("studio.navCulture")}</span>
        </span>
      </div>
      <div className="na-art">
        {source && (
          <span className={`pv-badge ${source === "ai" ? "ai" : "tpl"}`}>
            {source === "ai" ? t("studio.badgeAi") : t("studio.badgeTemplate")}
          </span>
        )}
        <div className="na-tag" style={{ marginLeft: 8 }}>{tag}</div>
        <h3
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onEditField("headline", e.currentTarget.textContent ?? "")}
        >
          {article.headline}
        </h3>
        <p
          className="na-standfirst"
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onEditField("standfirst", e.currentTarget.textContent ?? "")}
        >
          {article.standfirst}
        </p>
        <div className="na-byline">{article.byline}</div>
        <div
          className={photoUrl ? "na-photo" : `na-photo ${photoClass}`}
          style={
            photoUrl
              ? { backgroundImage: `url(${JSON.stringify(photoUrl)})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
        <div className="na-body">
          {article.body.map((para, i) => (
            <p
              key={i}
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => onEditBody(i, e.currentTarget.textContent ?? "")}
            >
              {para}
            </p>
          ))}
        </div>
        <div className="pv-edithint">{t("studio.editHint")}</div>
      </div>
    </div>
  );
}
