import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { PlanDocument as PlanDocumentModel, PlanDocumentRow, PlanDocumentSection } from "./plan-document";
// Registers the Inter font family (Nordic glyphs) before any render.
import "./fonts";

// The downloaded plan as a PDF, laid out like the offers the desk sends
// customers (title block, intro, one PUBLICATION | REACH | PRICE | STATUS table
// per section, "How the prices work" at the end). Every string comes from the
// model (plan-document.ts), shared with the Word twin (plan-docx.ts).

const styles = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, paddingTop: 40, paddingHorizontal: 40, paddingBottom: 56, color: "#1a1a1a" },
  eyebrow: { fontSize: 8, fontWeight: 700, color: "#666", textTransform: "uppercase", marginBottom: 3 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 9, color: "#666", marginBottom: 2 },
  intro: { fontSize: 9.5, lineHeight: 1.45, marginTop: 12, marginBottom: 8 },
  online: { padding: 8, backgroundColor: "#f4f4f4", borderRadius: 3, marginBottom: 14 },
  onlineText: { fontSize: 8.5, color: "#444", lineHeight: 1.4 },
  onlineLink: { fontSize: 8.5, color: "#1a4fd6" },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 3 },
  sectionIntro: { fontSize: 8.5, color: "#555", lineHeight: 1.4, marginBottom: 6 },
  briefRow: { flexDirection: "row", paddingVertical: 2 },
  briefLabel: { width: "26%", fontSize: 8.5, color: "#666" },
  briefValue: { width: "74%", fontSize: 9, lineHeight: 1.35 },
  tHead: { flexDirection: "row", borderBottom: "1pt solid #1a1a1a", paddingBottom: 4, marginTop: 2 },
  tHeadCell: { fontSize: 7, fontWeight: 700, textTransform: "uppercase", color: "#444" },
  tRow: { flexDirection: "row", borderBottom: "0.5pt solid #ddd", paddingVertical: 6 },
  colPublication: { width: "36%", paddingRight: 8 },
  colReach: { width: "19%", paddingRight: 6 },
  colPrice: { width: "23%", paddingRight: 6 },
  colStatus: { width: "22%" },
  rowTitle: { fontSize: 9.5, fontWeight: 700 },
  small: { fontSize: 7.5, color: "#666", marginTop: 2, lineHeight: 1.3 },
  // No italic Inter face is registered, so the note is set apart by colour.
  note: { fontSize: 7.5, color: "#2f4a6d", marginTop: 3, lineHeight: 1.3 },
  cell: { fontSize: 9 },
  priceFirm: { fontSize: 9, fontWeight: 700 },
  status: { fontSize: 8, color: "#555" },
  totalBox: { marginTop: 14, paddingTop: 8, borderTop: "1pt solid #1a1a1a" },
  totalLabel: { fontSize: 8.5, color: "#666", marginBottom: 3 },
  totalFigure: { fontSize: 11, fontWeight: 700, marginTop: 2 },
  totalNote: { fontSize: 8, color: "#555", marginTop: 2, lineHeight: 1.35 },
  pricesLine: { fontSize: 8.5, color: "#333", lineHeight: 1.45, marginBottom: 3 },
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
  footerLink: { color: "#999" },
});

function Row({ row, noteLabel }: { row: PlanDocumentRow; noteLabel: string }) {
  return (
    <View style={styles.tRow}>
      <View style={styles.colPublication}>
        <Text style={styles.rowTitle}>{row.title}</Text>
        <Text style={styles.small}>{row.subtitle}</Text>
        {row.details ? <Text style={styles.small}>{row.details}</Text> : null}
        {row.note ? (
          <Text style={styles.note}>
            {noteLabel}: {row.note}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.cell, styles.colReach]}>{row.reach}</Text>
      <View style={styles.colPrice}>
        <Text style={row.firm ? styles.priceFirm : styles.cell}>{row.price}</Text>
        {row.priceDetail ? <Text style={styles.small}>{row.priceDetail}</Text> : null}
      </View>
      <Text style={[styles.status, styles.colStatus]}>{row.status}</Text>
    </View>
  );
}

function Section({ section, doc }: { section: PlanDocumentSection; doc: PlanDocumentModel }) {
  const [first, ...rest] = section.rows;
  return (
    <View>
      {/* The heading, its intro, the column heads and the first row move to
          the next page together: a table never starts on a page's last line. */}
      <View wrap={false}>
        <Text style={styles.h2}>{section.heading}</Text>
        {section.intro ? <Text style={styles.sectionIntro}>{section.intro}</Text> : null}
        <View style={styles.tHead}>
          <Text style={[styles.tHeadCell, styles.colPublication]}>{doc.columns.publication}</Text>
          <Text style={[styles.tHeadCell, styles.colReach]}>{doc.columns.reach}</Text>
          <Text style={[styles.tHeadCell, styles.colPrice]}>{doc.columns.price}</Text>
          <Text style={[styles.tHeadCell, styles.colStatus]}>{doc.columns.status}</Text>
        </View>
        {first ? <Row row={first} noteLabel={doc.noteLabel} /> : null}
      </View>
      {rest.map((r) => (
        <View key={r.itemId} wrap={false}>
          <Row row={r} noteLabel={doc.noteLabel} />
        </View>
      ))}
    </View>
  );
}

export function PlanDocumentPdf({ doc }: { doc: PlanDocumentModel }) {
  return (
    <Document title={doc.documentTitle} author="NativeSpin" creator="NativeSpin" language={doc.locale}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.eyebrow}>{doc.eyebrow}</Text>
        <Text style={styles.title}>{doc.planName}</Text>
        <Text style={styles.meta}>{doc.meta}</Text>
        {doc.waveNote ? <Text style={styles.meta}>{doc.waveNote}</Text> : null}

        <Text style={styles.intro}>{doc.intro}</Text>
        <View style={styles.online} wrap={false}>
          <Text style={styles.onlineText}>{doc.link.lead}</Text>
          <Link src={doc.link.url} style={styles.onlineLink}>
            {doc.link.url}
          </Link>
          {doc.link.invite ? <Text style={[styles.onlineText, { marginTop: 3 }]}>{doc.link.invite}</Text> : null}
        </View>

        {doc.brief ? (
          <View wrap={false}>
            <Text style={styles.h2}>{doc.brief.heading}</Text>
            {doc.brief.entries.map((e) => (
              <View key={e.label} style={styles.briefRow}>
                <Text style={styles.briefLabel}>{e.label}</Text>
                <Text style={styles.briefValue}>{e.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {doc.sections.slice(0, 1).map((s) => (
          <Section key={s.key} section={s} doc={doc} />
        ))}

        <View style={styles.totalBox} wrap={false}>
          <Text style={styles.totalLabel}>{doc.total.label}</Text>
          {doc.total.rows.map((r) => (
            <View key={r.currency}>
              <Text style={styles.totalFigure}>{r.figure}</Text>
              {r.notes.map((n) => (
                <Text key={n} style={styles.totalNote}>
                  {n}
                </Text>
              ))}
            </View>
          ))}
          {doc.total.empty ? <Text style={styles.totalFigure}>{doc.total.empty}</Text> : null}
          {doc.total.notes.map((n) => (
            <Text key={n} style={styles.totalNote}>
              {n}
            </Text>
          ))}
        </View>

        {doc.sections.slice(1).map((s) => (
          <Section key={s.key} section={s} doc={doc} />
        ))}

        <View wrap={false}>
          <Text style={styles.h2}>{doc.prices.heading}</Text>
          {doc.prices.lines.map((l) => (
            <Text key={l} style={styles.pricesLine}>
              {l}
            </Text>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>NativeSpin · {doc.footer.org}</Text>
          <Link src={doc.link.url} style={styles.footerLink}>
            {doc.footer.linkLabel}
          </Link>
          <Text
            render={({ pageNumber, totalPages }) =>
              doc.footer.pageOf.replace("{page}", String(pageNumber)).replace("{pages}", String(totalPages))
            }
          />
        </View>
      </Page>
    </Document>
  );
}
