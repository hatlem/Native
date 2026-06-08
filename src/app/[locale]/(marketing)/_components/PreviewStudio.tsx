"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Article, MarketCode, Tone } from "@/lib/preview/schema";
import { PreviewControls, type MarketOption } from "./PreviewControls";
import { PreviewArticle, type ArticleField } from "./PreviewArticle";

interface MarketMeta extends MarketOption {
  disclosureLabel: string;
}

const FALLBACK: Article = {
  headline: "Your headline appears here",
  standfirst: "Type your brand, pick a market, and generate a sample native article.",
  byline: "By the editorial desk · 8 min read",
  body: [
    "This is placeholder body text. Hit Generate and the desk's AI will write a sample native article in the publication's voice, using your brand and what you want to promote.",
    "Native advertising reads like the page it sits on — that's the whole point. The preview shows you exactly how a reader would meet it.",
  ],
};

export function PreviewStudio({ markets, defaultDisclosure }: { markets: MarketMeta[]; defaultDisclosure: string }) {
  const t = useTranslations("landing");
  const [brand, setBrand] = useState("Volvo");
  const [market, setMarket] = useState<MarketCode>(markets[0]?.code ?? "NO");
  const [tone, setTone] = useState<Tone>("warm");
  const [product, setProduct] = useState(
    "A new fully-electric SUV built for Nordic winters — long range, quiet, family-friendly.",
  );
  const [preset, setPreset] = useState("pv-pa");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [article, setArticle] = useState<Article>(FALLBACK);
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const disclosure = markets.find((m) => m.code === market)?.disclosureLabel || defaultDisclosure;

  // Release the object URL when the uploaded image is replaced, swapped for a
  // preset, or the studio unmounts — otherwise each upload leaks a blob.
  useEffect(() => {
    if (!photoUrl) return;
    return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  async function generate() {
    setLoading(true);
    setError(false);
    setSource(null); // clear the prior badge so it can't mislabel this run
    try {
      const res = await fetch("/api/preview-ad", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, product, market, tone }),
      });
      if (!res.ok) throw new Error("bad_status");
      const data = (await res.json()) as { source: "ai" | "template"; article: Article };
      setArticle(data.article);
      setSource(data.source);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function editField(field: ArticleField, value: string) {
    setArticle((a) => ({ ...a, [field]: value }));
  }
  function editBody(index: number, value: string) {
    setArticle((a) => ({ ...a, body: a.body.map((p, i) => (i === index ? value : p)) }));
  }
  function upload(file: File) {
    setPhotoUrl(URL.createObjectURL(file));
  }

  return (
    <div className="preview-studio">
      <PreviewControls
        brand={brand}
        market={market}
        tone={tone}
        product={product}
        markets={markets}
        preset={preset}
        loading={loading}
        onBrand={setBrand}
        onMarket={setMarket}
        onTone={setTone}
        onProduct={setProduct}
        onPreset={(cls) => { setPreset(cls); setPhotoUrl(null); }}
        onUpload={upload}
        onGenerate={generate}
      />
      <div>
        <PreviewArticle
          article={article}
          source={source}
          brand={brand}
          disclosureLabel={disclosure}
          photoClass={preset}
          photoUrl={photoUrl}
          onEditField={editField}
          onEditBody={editBody}
        />
        {error && <div className="pv-error">{t("studio.errorGenerate")}</div>}
      </div>
    </div>
  );
}
