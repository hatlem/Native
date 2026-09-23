import path from "node:path";
import { Document, Page, View, Text, Link, StyleSheet, Font } from "@react-pdf/renderer";
import { formatMoney, intlLocale } from "@/lib/money";
import type { QuotePdfData } from "./quote-pdf-data";
import { qt as t, quoteRowBlurb, type QuoteMessages } from "./quote-messages";

// react-pdf's built-in Helvetica has no Nordic glyphs (æ/ø/å, etc.) — every
// quote must render Norwegian text correctly, so we register a real
// Unicode font instead of leaving that to the default. Self-hosted from
// public/fonts/ rather than fetched from Google's CDN at render time —
// gstatic's per-version file hashes rotate and go stale (the original
// hardcoded v13 URL 404'd in production), so PDF generation must not depend
// on a live external fetch succeeding.
const FONTS_DIR = path.join(process.cwd(), "public", "fonts");
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(FONTS_DIR, "Inter-Regular.ttf") },
    {
      src: path.join(FONTS_DIR, "Inter-Bold.ttf"),
      fontWeight: 700,
    },
  ],
});

const styles = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, padding: 40, color: "#1a1a1a" },
  brand: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  brandSub: { fontSize: 8, color: "#666", marginBottom: 20 },
  headRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  metaLabel: { fontSize: 7, color: "#666", textTransform: "uppercase" },
  metaValue: { fontSize: 9, marginBottom: 6 },
  intro: { fontSize: 9.5, marginBottom: 10, lineHeight: 1.4 },
  online: {
    marginBottom: 16,
    padding: 8,
    backgroundColor: "#f4f4f4",
    borderRadius: 3,
  },
  onlineText: { fontSize: 8.5, color: "#444", marginBottom: 2 },
  onlineLink: { fontSize: 8.5, color: "#1a4fd6", textDecoration: "none" },
  footerLink: { color: "#999", textDecoration: "none" },
  table: { marginBottom: 4 },
  tHead: {
    flexDirection: "row",
    borderBottom: "1pt solid #1a1a1a",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tHeadCell: { fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", color: "#444" },
  tRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #ddd",
    paddingVertical: 5,
  },
  tCell: { fontSize: 9 },
  colTitle: { width: "26%" },
  colMarket: { width: "10%" },
  colFormat: { width: "18%" },
  colQty: { width: "10%", textAlign: "right" },
  colUnit: { width: "16%", textAlign: "right" },
  colTotal: { width: "20%", textAlign: "right" },
  blurb: { fontSize: 7.5, color: "#666", marginTop: 2 },
  totals: { marginTop: 12, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 220, justifyContent: "space-between", marginBottom: 3 },
  totalLabel: { fontSize: 9, color: "#444" },
  totalValue: { fontSize: 9 },
  grandTotalRow: {
    flexDirection: "row",
    width: 220,
    justifyContent: "space-between",
    borderTop: "1pt solid #1a1a1a",
    paddingTop: 4,
    marginTop: 2,
  },
  grandTotalLabel: { fontSize: 10, fontWeight: 700 },
  grandTotalValue: { fontSize: 10, fontWeight: 700 },
  notes: { marginTop: 20, fontSize: 8, color: "#555", lineHeight: 1.5 },
  // No fontStyle: only Inter Regular/Bold are registered, and react-pdf
  // throws on an unregistered italic — which failed every quote carrying a
  // price-on-request line (the only case that renders this footnote).
  footnote: { marginTop: 8, fontSize: 7.5, color: "#888" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#999",
    borderTop: "0.5pt solid #ddd",
    paddingTop: 6,
  },
});

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(date);
}

export function QuoteDocument({
  data,
  locale,
  messages,
}: {
  data: QuotePdfData;
  locale: string;
  messages: QuoteMessages;
}) {
  const money = (amount: number) => formatMoney(amount, data.currency, locale);
  const onRequest = data.rows.filter((r) => r.priceOnRequest);

  return (
    <Document title={t(messages, "documentTitle", { quoteNumber: data.quoteNumber })}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>NativeSpin</Text>
        <Link src={data.onlineUrl} style={[styles.brandSub, { textDecoration: "none" }]}>
          nativespin.com
        </Link>

        <View style={styles.headRow}>
          <View>
            <Text style={styles.metaLabel}>{t(messages, "preparedFor")}</Text>
            <Text style={styles.metaValue}>{data.organizationName}</Text>
            <Text style={styles.metaLabel}>{t(messages, "quoteNumber")}</Text>
            <Text style={styles.metaValue}>{data.quoteNumber}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>{t(messages, "date")}</Text>
            <Text style={styles.metaValue}>{formatDate(data.createdAt, locale)}</Text>
            {data.validUntil ? (
              <>
                <Text style={styles.metaLabel}>{t(messages, "validUntil")}</Text>
                <Text style={styles.metaValue}>{formatDate(data.validUntil, locale)}</Text>
              </>
            ) : null}
            <Text style={styles.metaLabel}>{t(messages, "preparedBy")}</Text>
            <Text style={styles.metaValue}>
              {data.preparedByName} · {data.preparedByEmail}
            </Text>
          </View>
        </View>

        <Text style={styles.intro}>{t(messages, "intro", { org: data.organizationName })}</Text>

        <View style={styles.online}>
          <Text style={styles.onlineText}>{t(messages, "viewOnline")}</Text>
          <Link src={data.onlineUrl} style={styles.onlineLink}>
            {data.onlineUrl}
          </Link>
        </View>

        <View style={styles.table}>
          <View style={styles.tHead}>
            <Text style={[styles.tHeadCell, styles.colTitle]}>{t(messages, "colTitle")}</Text>
            <Text style={[styles.tHeadCell, styles.colMarket]}>{t(messages, "colMarket")}</Text>
            <Text style={[styles.tHeadCell, styles.colFormat]}>{t(messages, "colFormat")}</Text>
            <Text style={[styles.tHeadCell, styles.colQty]}>{t(messages, "colQty")}</Text>
            <Text style={[styles.tHeadCell, styles.colUnit]}>{t(messages, "colUnitPrice")}</Text>
            <Text style={[styles.tHeadCell, styles.colTotal]}>{t(messages, "colRowTotal")}</Text>
          </View>
          {data.rows.map((row, i) => {
            const blurb = quoteRowBlurb(row, messages, locale);
            return (
              <View key={i} style={styles.tRow}>
                <View style={styles.colTitle}>
                  <Text style={styles.tCell}>{row.titleName}</Text>
                  {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}
                </View>
                <Text style={[styles.tCell, styles.colMarket]}>{row.marketCode}</Text>
                <Text style={[styles.tCell, styles.colFormat]}>{row.format}</Text>
                <Text style={[styles.tCell, styles.colQty]}>{row.quantity}</Text>
                <Text style={[styles.tCell, styles.colUnit]}>
                  {row.priceOnRequest || row.unitPrice === null
                    ? t(messages, "priceOnRequest")
                    : money(row.unitPrice)}
                </Text>
                <Text style={[styles.tCell, styles.colTotal]}>
                  {row.priceOnRequest || row.rowTotal === null
                    ? t(messages, "priceOnRequest")
                    : money(row.rowTotal)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(messages, "subtotal")}</Text>
            <Text style={styles.totalValue}>{money(data.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(messages, "vat", { pct: data.vatPct })}</Text>
            <Text style={styles.totalValue}>{money(data.total - data.subtotal)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>{t(messages, "total")}</Text>
            <Text style={styles.grandTotalValue}>{money(data.total)}</Text>
          </View>
        </View>

        <View style={styles.notes}>
          <Text>{t(messages, "vatStatus")}</Text>
          <Text>{t(messages, "paymentTerms")}</Text>
        </View>

        {onRequest.length > 0 ? (
          <Text style={styles.footnote}>{t(messages, "footnote")}</Text>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>{data.organizationName}</Text>
          <Link src={data.onlineUrl} style={styles.footerLink}>
            {t(messages, "footerLink")}
          </Link>
          <Text
            render={({ pageNumber, totalPages }) =>
              t(messages, "pageOf", { page: pageNumber, pages: totalPages })
            }
          />
        </View>
      </Page>
    </Document>
  );
}
