import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { formatMoney, intlLocale } from "@/lib/money";
import type { InvoicePdfData } from "./invoice-pdf-data";
import { qt as t, type QuoteMessages } from "./quote-messages";
import { paymentTermsLine } from "@/lib/payment-terms-text";
import { PDF_FONT_FAMILY } from "./fonts";
import { sellerAddressLines, type SellerDetails } from "@/lib/seller";

// Customer-facing invoice document. Visual language matches QuoteDocument
// so a buyer's quote and invoice read as one set.
const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 9, padding: 40, color: "#1a1a1a" },
  brand: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  brandSub: { fontSize: 8, color: "#666", marginBottom: 20 },
  docTitle: { fontSize: 14, fontWeight: 700, marginBottom: 12 },
  headRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  metaLabel: { fontSize: 7, color: "#666", textTransform: "uppercase" },
  metaValue: { fontSize: 9, marginBottom: 6 },
  address: { fontSize: 9, marginTop: -4, marginBottom: 6 },
  terms: { marginTop: 16, fontSize: 8.5, color: "#555" },
  tHead: {
    flexDirection: "row",
    borderBottom: "1pt solid #1a1a1a",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tHeadCell: { fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", color: "#444" },
  tRow: { flexDirection: "row", borderBottom: "0.5pt solid #ddd", paddingVertical: 5 },
  tCell: { fontSize: 9 },
  colDesc: { width: "52%" },
  colQty: { width: "10%", textAlign: "right" },
  colUnit: { width: "18%", textAlign: "right" },
  colAmount: { width: "20%", textAlign: "right" },
  totals: { marginTop: 12, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 220, justifyContent: "space-between", marginBottom: 3 },
  totalLabel: { fontSize: 9, color: "#444" },
  grandTotalRow: {
    flexDirection: "row",
    width: 220,
    justifyContent: "space-between",
    borderTop: "1pt solid #1a1a1a",
    paddingTop: 4,
    marginTop: 2,
  },
  grandTotal: { fontSize: 10, fontWeight: 700 },
  credit: {
    marginTop: 20,
    padding: 8,
    backgroundColor: "#f4f4f4",
    borderRadius: 3,
  },
  creditHeading: { fontSize: 9, fontWeight: 700, marginBottom: 2 },
  seller: { alignItems: "flex-end", fontSize: 8, color: "#444", lineHeight: 1.35 },
  sellerName: { fontSize: 9, fontWeight: 700, color: "#1a1a1a" },
  payment: { marginTop: 16, padding: 8, border: "0.5pt solid #ddd", borderRadius: 3 },
  paymentHeading: { fontSize: 7, color: "#666", textTransform: "uppercase", marginBottom: 3 },
  paymentText: { fontSize: 9, marginBottom: 1 },
  creditText: { fontSize: 8.5, color: "#444", lineHeight: 1.4 },
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

// The seller's registration line: "Org.nr. 974 760 673 MVA · Foretaksregisteret".
function registrationLine(seller: SellerDetails, messages: QuoteMessages): string {
  return [
    seller.orgNumber ? `${t(messages, "sellerOrgNumber")} ${seller.orgNumber}` : null,
    seller.registry,
  ]
    .filter(Boolean)
    .join(" · ");
}

// The render route only calls this with a seller that passed sellerGaps()
// for the invoice's currency (lib/seller.ts) — a legally complete invoice.
export function InvoiceDocument({
  data,
  seller,
  locale,
  messages,
}: {
  data: InvoicePdfData;
  seller: SellerDetails;
  locale: string;
  messages: QuoteMessages;
}) {
  const money = (amount: number) => formatMoney(amount, data.currency, locale);
  // A NOK invoice shows the domestic account (when set); IBAN + BIC follow
  // for everyone else — sellerGaps() guarantees them on non-NOK invoices.
  const domestic = data.currency === "NOK" && !!seller.bankAccount;

  return (
    <Document title={t(messages, "documentTitle", { number: data.number })}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headRow}>
          <View>
            <Text style={styles.brand}>NativeSpin</Text>
            <Text style={styles.brandSub}>nativespin.com</Text>
          </View>
          {/* The seller of record — name, address and registration, as a
              Norwegian sales document must state them. */}
          <View style={styles.seller}>
            <Text style={styles.sellerName}>{seller.legalName}</Text>
            {sellerAddressLines(seller).map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            <Text>{registrationLine(seller, messages)}</Text>
            {seller.vatNumber ? (
              <Text>
                {t(messages, "sellerVatNumber")} {seller.vatNumber}
              </Text>
            ) : null}
            {seller.email ? <Text>{seller.email}</Text> : null}
          </View>
        </View>
        <Text style={styles.docTitle}>{t(messages, "documentTitle", { number: data.number })}</Text>

        <View style={styles.headRow}>
          <View>
            <Text style={styles.metaLabel}>{t(messages, "billTo")}</Text>
            <Text style={styles.metaValue}>{data.customer.name}</Text>
            {data.customer.addressLines.map((line, i) => (
              <Text key={i} style={styles.address}>
                {line}
              </Text>
            ))}
            {data.customer.vatId ? (
              <>
                <Text style={styles.metaLabel}>{t(messages, "vatId")}</Text>
                <Text style={styles.metaValue}>{data.customer.vatId}</Text>
              </>
            ) : null}
          </View>
          <View>
            <Text style={styles.metaLabel}>{t(messages, "number")}</Text>
            <Text style={styles.metaValue}>{data.number}</Text>
            {data.accountingNumber ? (
              <>
                <Text style={styles.metaLabel}>{t(messages, "accountingRef")}</Text>
                <Text style={styles.metaValue}>{data.accountingNumber}</Text>
              </>
            ) : null}
            {data.issuedAt ? (
              <>
                <Text style={styles.metaLabel}>{t(messages, "issued")}</Text>
                <Text style={styles.metaValue}>{formatDate(data.issuedAt, locale)}</Text>
              </>
            ) : null}
            {data.dueAt ? (
              <>
                <Text style={styles.metaLabel}>{t(messages, "due")}</Text>
                <Text style={styles.metaValue}>{formatDate(data.dueAt, locale)}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View>
          <View style={styles.tHead}>
            <Text style={[styles.tHeadCell, styles.colDesc]}>{t(messages, "colDescription")}</Text>
            <Text style={[styles.tHeadCell, styles.colQty]}>{t(messages, "colQty")}</Text>
            <Text style={[styles.tHeadCell, styles.colUnit]}>{t(messages, "colUnitPrice")}</Text>
            <Text style={[styles.tHeadCell, styles.colAmount]}>{t(messages, "colAmount")}</Text>
          </View>
          {data.rows.map((row, i) => (
            <View key={i} style={styles.tRow} wrap={false}>
              <Text style={[styles.tCell, styles.colDesc]}>{row.label}</Text>
              <Text style={[styles.tCell, styles.colQty]}>{row.quantity}</Text>
              <Text style={[styles.tCell, styles.colUnit]}>{money(row.unitAmount)}</Text>
              <Text style={[styles.tCell, styles.colAmount]}>{money(row.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(messages, "subtotal")}</Text>
            <Text>{money(data.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(messages, "vatWithPct", { pct: data.vatPct })}</Text>
            <Text>{money(data.total - data.subtotal)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotal}>{t(messages, "total")}</Text>
            <Text style={styles.grandTotal}>{money(data.total)}</Text>
          </View>
        </View>

        {data.paymentTermsDays ? (
          <Text style={styles.terms}>{paymentTermsLine(locale, data.paymentTermsDays)}</Text>
        ) : null}

        <View style={styles.payment} wrap={false}>
          <Text style={styles.paymentHeading}>{t(messages, "paymentHeading")}</Text>
          {domestic ? (
            <Text style={styles.paymentText}>
              {t(messages, "bankAccount")}: {seller.bankAccount}
            </Text>
          ) : null}
          {seller.iban ? <Text style={styles.paymentText}>IBAN: {seller.iban}</Text> : null}
          {seller.bic ? <Text style={styles.paymentText}>BIC/SWIFT: {seller.bic}</Text> : null}
          <Text style={styles.paymentText}>
            {t(messages, "paymentReference")}: {data.number}
          </Text>
        </View>

        {data.credit ? (
          <View style={styles.credit}>
            <Text style={styles.creditHeading}>{t(messages, "creditedHeading")}</Text>
            <Text style={styles.creditText}>
              {t(messages, "creditedBody", {
                date: formatDate(data.credit.issuedAt, locale),
                amount: money(data.credit.amount),
              })}
            </Text>
            <Text style={styles.creditText}>
              {t(messages, "creditedReason", { reason: data.credit.reason })}
            </Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {[seller.legalName, seller.orgNumber ? `${t(messages, "sellerOrgNumber")} ${seller.orgNumber}` : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
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
