import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableRow,
  WidthType,
  type IBorderOptions,
} from "docx";
import { formatMoney, intlLocale } from "@/lib/money";
import { paymentTermsLine } from "@/lib/payment-terms-text";
import type { QuotePdfData, QuotePdfRow } from "./quote-pdf-data";
import { qt as t, quoteFormatLabel, quoteRowBlurb, type QuoteMessages } from "./quote-messages";
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

// Editable (.docx) twin of QuoteDocument.tsx: same QuotePdfData, same copy,
// same customer-safe fields, so the desk can tweak wording before sending
// without the numbers drifting from the PDF. Opens in Word, LibreOffice
// (incl. save-as .odt), Pages and Google Docs.

// Column widths in percent, identical to the PDF table.
const COLS = [26, 10, 18, 10, 16, 20] as const;

function metaBlock(label: string, value: string) {
  return [
    para([run(label.toUpperCase(), { size: SIZE.label, color: COLOR.muted })]),
    para([run(value)], { after: 120 }),
  ];
}

function rowPrice(row: QuotePdfRow, amount: number | null, messages: QuoteMessages, money: (n: number) => string) {
  return row.priceOnRequest || amount === null ? t(messages, "priceOnRequest") : money(amount);
}

export async function renderQuoteDocx(
  data: QuotePdfData,
  locale: string,
  messages: QuoteMessages,
): Promise<Buffer> {
  const money = (amount: number) => formatMoney(amount, data.currency, locale);
  const date = (d: Date) =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: data.timeZone }).format(d);
  const hasOnRequest = data.rows.some((r) => r.priceOnRequest);

  const header = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: grid([60, 40]),
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({
        children: [
          cell(
            [
              ...metaBlock(t(messages, "preparedFor"), data.organizationName),
              ...metaBlock(t(messages, "quoteNumber"), data.quoteNumber),
              ...(data.revision
                ? metaBlock(
                    t(messages, "revision"),
                    t(messages, "revisionValue", {
                      revision: data.revision.number,
                      previous: data.revision.replacesQuoteNumber,
                    }),
                  )
                : []),
            ],
            60,
          ),
          cell(
            [
              ...metaBlock(t(messages, "date"), date(data.createdAt)),
              ...(data.validUntil ? metaBlock(t(messages, "validUntil"), date(data.validUntil)) : []),
              ...metaBlock(t(messages, "preparedBy"), `${data.preparedByName} · ${data.preparedByEmail}`),
            ],
            40,
          ),
        ],
      }),
    ],
  });

  const right = AlignmentType.RIGHT;
  const headCells = [
    ["colTitle", undefined],
    ["colMarket", undefined],
    ["colFormat", undefined],
    ["colQty", right],
    ["colUnitPrice", right],
    ["colRowTotal", right],
  ] as const;

  const lines = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: grid(COLS),
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headCells.map(([key, align], i) =>
          cell(
            [para([run(t(messages, key).toUpperCase(), { bold: true, size: SIZE.label, color: "444444" })], { align })],
            COLS[i],
            { bottom: HEAVY_RULE },
          ),
        ),
      }),
      ...data.rows.map((row) => {
        const blurb = quoteRowBlurb(row, messages, locale);
        const values = [
          row.marketCode,
          quoteFormatLabel(row.format, locale),
          String(row.quantity),
          rowPrice(row, row.unitPrice, messages, money),
          rowPrice(row, row.rowTotal, messages, money),
        ];
        return new TableRow({
          cantSplit: true,
          children: [
            cell(
              [
                para([run(row.titleName)]),
                ...(blurb ? [para([run(blurb, { size: SIZE.small, color: COLOR.muted })])] : []),
                ...(row.customerNote
                  ? [
                      para([
                        run(`${t(messages, "noteLabel")}: ${row.customerNote}`, {
                          size: SIZE.small,
                          italics: true,
                        }),
                      ]),
                    ]
                  : []),
              ],
              COLS[0],
              { bottom: RULE },
            ),
            ...values.map((v, i) =>
              cell([para([run(v)], { align: i >= 2 ? right : undefined })], COLS[i + 1], { bottom: RULE }),
            ),
          ],
        });
      }),
    ],
  });

  const totalLine = (label: string, value: string, bold = false, top?: IBorderOptions) =>
    new TableRow({
      children: [
        cell([para([run(label, { bold, color: bold ? COLOR.text : "444444" })])], 60, { top }),
        cell([para([run(value, { bold })], { align: right })], 40, { top }),
      ],
    });

  const totals = new Table({
    width: { size: 40, type: WidthType.PERCENTAGE },
    columnWidths: grid([24, 16]),
    alignment: AlignmentType.RIGHT,
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      totalLine(t(messages, "subtotal"), money(data.subtotal)),
      totalLine(t(messages, "vat", { pct: data.vatPct }), money(data.total - data.subtotal)),
      totalLine(t(messages, "total"), money(data.total), true, HEAVY_RULE),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        border: { top: RULE },
        spacing: { before: 80 },
        children: [
          run(`${data.organizationName}   ·   `, { size: SIZE.label, color: "999999" }),
          link(data.onlineUrl, t(messages, "footerLink"), SIZE.label, "999999"),
          run("   ·   ", { size: SIZE.label, color: "999999" }),
          // "pageOf" is "Page {page} of {pages}" — split around the two
          // placeholders so Word fills in live page fields.
          ...pageOfRuns(t(messages, "pageOf")),
        ],
      }),
    ],
  });

  const doc = new Document({
    title: t(messages, "documentTitle", { quoteNumber: data.quoteNumber }),
    creator: "NativeSpin",
    styles: { default: { document: { run: { font: FONT, size: SIZE.body, color: COLOR.text } } } },
    sections: [
      {
        properties: {
          page: A4_PAGE,
        },
        footers: { default: footer },
        children: [
          para([run("NativeSpin", { bold: true, size: SIZE.brand })]),
          para([link(data.onlineUrl, "nativespin.com", SIZE.small, COLOR.muted)], { after: 320 }),
          header,
          para([run(t(messages, "intro", { org: data.organizationName }), { size: 19 })], { after: 160 }),
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: "F4F4F4", color: "auto" },
            spacing: { before: 0, after: 0 },
            children: [run(t(messages, "viewOnline"), { size: 17, color: "444444" })],
          }),
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: "F4F4F4", color: "auto" },
            spacing: { after: 320 },
            children: [link(data.onlineUrl, data.onlineUrl, 17)],
          }),
          lines,
          para([], { after: 200 }),
          totals,
          para([], { after: 320 }),
          para([run(t(messages, "vatStatus"), { size: 16, color: "555555" })]),
          para([run(paymentTermsLine(locale, data.paymentTermsDays), { size: 16, color: "555555" })], {
            after: 160,
          }),
          ...(hasOnRequest ? [para([run(t(messages, "footnote"), { size: SIZE.small, color: COLOR.faint })])] : []),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

