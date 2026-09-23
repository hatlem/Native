import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
} from "docx";
import { formatMoney, intlLocale } from "@/lib/money";
import type { QuotePdfData, QuotePdfRow } from "./quote-pdf-data";
import { qt as t, quoteFormatLabel, quoteRowBlurb, type QuoteMessages } from "./quote-messages";

// Editable (.docx) twin of QuoteDocument.tsx: same QuotePdfData, same copy,
// same customer-safe fields, so the desk can tweak wording before sending
// without the numbers drifting from the PDF. Opens in Word, LibreOffice
// (incl. save-as .odt), Pages and Google Docs.

const FONT = "Inter";
// docx sizes are half-points: 18 = 9pt, matching the PDF's body size.
const SIZE = { body: 18, small: 15, brand: 32, label: 14 } as const;
const COLOR = { text: "1A1A1A", muted: "666666", faint: "888888", link: "1A4FD6" };

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" };
const HEAVY_RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 8, color: "1A1A1A" };

// Column widths in percent, identical to the PDF table. LibreOffice ignores
// per-cell percentages, so tables also get an explicit twip grid.
const COLS = [26, 10, 18, 10, 16, 20] as const;
// A4 width 11906 twips minus two 800-twip margins.
const CONTENT_TWIPS = 11906 - 2 * 800;
const grid = (pcts: readonly number[]) => pcts.map((p) => Math.round((CONTENT_TWIPS * p) / 100));

function run(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({
    text,
    font: FONT,
    bold: opts.bold,
    size: opts.size ?? SIZE.body,
    color: opts.color ?? COLOR.text,
  });
}

function link(url: string, text: string, size: number = SIZE.body, color: string = COLOR.link) {
  return new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text, font: FONT, size, color, underline: {} })],
  });
}

function cell(
  children: Paragraph[],
  widthPct: number,
  borders: { top?: IBorderOptions; bottom?: IBorderOptions } = {},
) {
  return new TableCell({
    children,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: { ...NO_BORDERS, ...borders },
    margins: { top: 80, bottom: 80, left: 0, right: 80 },
  });
}

function para(
  children: (TextRun | ExternalHyperlink)[],
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {},
) {
  return new Paragraph({ children, alignment: opts.align, spacing: { after: opts.after ?? 0 } });
}

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
  const date = (d: Date) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(d);
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
          // A4 with the PDF's 40pt (800 twip) margins.
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 800, bottom: 800, left: 800, right: 800 },
          },
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
          para([run(t(messages, "paymentTerms"), { size: 16, color: "555555" })], { after: 160 }),
          ...(hasOnRequest ? [para([run(t(messages, "footnote"), { size: SIZE.small, color: COLOR.faint })])] : []),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function pageOfRuns(template: string): TextRun[] {
  const style = { font: FONT, size: SIZE.label, color: "999999" };
  return template
    .split(/(\{page\}|\{pages\})/)
    .filter(Boolean)
    .map((part) =>
      part === "{page}"
        ? new TextRun({ ...style, children: [PageNumber.CURRENT] })
        : part === "{pages}"
          ? new TextRun({ ...style, children: [PageNumber.TOTAL_PAGES] })
          : new TextRun({ ...style, text: part }),
    );
}
