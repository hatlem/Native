import { Document, Footer, Packer, Paragraph, ShadingType, Table, TableRow, WidthType } from "docx";
import type { PlanDocument, PlanDocumentSection } from "./plan-document";
import {
  A4_PAGE,
  COLOR,
  FONT,
  HEAVY_RULE,
  NONE,
  NO_BORDERS,
  RULE,
  SIZE,
  cell,
  grid,
  link,
  pageOfRuns,
  para,
  run,
} from "./docx-kit";

// Editable (.docx) twin of PlanDocument.tsx: the same model, the same strings,
// the same table per section, so a buyer can adjust the wording in Word,
// LibreOffice, Pages or Google Docs before passing the plan on, without the
// figures drifting from the PDF or from /plan.

// Column widths in percent, identical to the PDF table.
const COLS = [36, 19, 23, 22] as const;
const BRIEF_COLS = [26, 74] as const;

const TABLE_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };

function heading(text: string, before = 240) {
  return new Paragraph({
    keepNext: true,
    spacing: { before, after: 60 },
    children: [run(text, { bold: true, size: 24 })],
  });
}

function sectionTable(section: PlanDocumentSection, doc: PlanDocument): Table {
  const headCells = [doc.columns.publication, doc.columns.reach, doc.columns.price, doc.columns.status];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: grid(COLS),
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headCells.map((label, i) =>
          cell([para([run(label.toUpperCase(), { bold: true, size: SIZE.label, color: "444444" })])], COLS[i], {
            bottom: HEAVY_RULE,
          }),
        ),
      }),
      ...section.rows.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: [
              cell(
                [
                  para([run(r.title, { bold: true, size: 19 })]),
                  para([run(r.subtitle, { size: SIZE.small, color: COLOR.muted })]),
                  ...(r.details ? [para([run(r.details, { size: SIZE.small, color: COLOR.muted })])] : []),
                  ...(r.note
                    ? [para([run(`${doc.noteLabel}: ${r.note}`, { size: SIZE.small, italics: true, color: "2F4A6D" })])]
                    : []),
                ],
                COLS[0],
                { bottom: RULE },
              ),
              cell([para([run(r.reach)])], COLS[1], { bottom: RULE }),
              cell(
                [
                  para([run(r.price, { bold: r.firm })]),
                  ...(r.priceDetail ? [para([run(r.priceDetail, { size: SIZE.small, color: COLOR.muted })])] : []),
                ],
                COLS[2],
                { bottom: RULE },
              ),
              cell([para([run(r.status, { size: 16, color: "555555" })])], COLS[3], { bottom: RULE }),
            ],
          }),
      ),
    ],
  });
}

function section(s: PlanDocumentSection, doc: PlanDocument) {
  return [
    heading(s.heading),
    ...(s.intro ? [para([run(s.intro, { size: 17, color: "555555" })], { after: 120 })] : []),
    sectionTable(s, doc),
  ];
}

export async function renderPlanDocx(doc: PlanDocument): Promise<Buffer> {
  const shaded = (children: Parameters<typeof para>[0], after = 0) =>
    new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "F4F4F4", color: "auto" }, spacing: { after }, children });

  const brief = doc.brief
    ? [
        heading(doc.brief.heading),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: grid(BRIEF_COLS),
          borders: TABLE_BORDERS,
          rows: doc.brief.entries.map(
            (e) =>
              new TableRow({
                cantSplit: true,
                children: [
                  cell([para([run(e.label, { size: 17, color: COLOR.muted })])], BRIEF_COLS[0]),
                  cell([para([run(e.value)])], BRIEF_COLS[1]),
                ],
              }),
          ),
        }),
      ]
    : [];

  const total = [
    new Paragraph({
      border: { top: HEAVY_RULE },
      keepNext: true,
      spacing: { before: 280, after: 40 },
      children: [run(doc.total.label, { size: 17, color: COLOR.muted })],
    }),
    ...doc.total.rows.flatMap((r) => [
      para([run(r.figure, { bold: true, size: 22 })], { after: 20 }),
      ...r.notes.map((n) => para([run(n, { size: 16, color: "555555" })])),
    ]),
    ...(doc.total.empty ? [para([run(doc.total.empty, { bold: true, size: 22 })])] : []),
    ...doc.total.notes.map((n) => para([run(n, { size: 16, color: "555555" })])),
  ];

  const footer = new Footer({
    children: [
      new Paragraph({
        border: { top: RULE },
        spacing: { before: 80 },
        children: [
          run(`NativeSpin · ${doc.footer.org}   ·   `, { size: SIZE.label, color: "999999" }),
          link(doc.link.url, doc.footer.linkLabel, SIZE.label, "999999"),
          run("   ·   ", { size: SIZE.label, color: "999999" }),
          ...pageOfRuns(doc.footer.pageOf),
        ],
      }),
    ],
  });

  const [planSection, ...otherSections] = doc.sections;
  const document = new Document({
    title: doc.documentTitle,
    creator: "NativeSpin",
    styles: { default: { document: { run: { font: FONT, size: SIZE.body, color: COLOR.text } } } },
    sections: [
      {
        properties: { page: A4_PAGE },
        footers: { default: footer },
        children: [
          para([run(doc.eyebrow.toUpperCase(), { bold: true, size: 16, color: COLOR.muted })], { after: 40 }),
          para([run(doc.planName, { bold: true, size: 36 })], { after: 60 }),
          para([run(doc.meta, { color: COLOR.muted })]),
          ...(doc.waveNote ? [para([run(doc.waveNote, { color: COLOR.muted })])] : []),
          para([run(doc.intro, { size: 19 })], { after: 160 }),
          shaded([run(doc.link.lead, { size: 17, color: "444444" })]),
          shaded([link(doc.link.url, doc.link.url, 17)], doc.link.invite ? 0 : 240),
          ...(doc.link.invite ? [shaded([run(doc.link.invite, { size: 17, color: "444444" })], 240)] : []),
          ...brief,
          ...section(planSection, doc),
          ...total,
          ...otherSections.flatMap((s) => section(s, doc)),
          heading(doc.prices.heading, 320),
          ...doc.prices.lines.map((l) => para([run(l, { size: 17, color: "333333" })], { after: 60 })),
        ],
      },
    ],
  });

  return Packer.toBuffer(document);
}
