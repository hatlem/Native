import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  PageNumber,
  Paragraph,
  TableCell,
  TextRun,
  WidthType,
  type IBorderOptions,
} from "docx";

// The building blocks every customer .docx shares (the quote, the downloaded
// plan): one font, one type scale, one set of rules and margins, so the Word
// documents we hand customers look like one family and like their PDF twins.

export const FONT = "Inter";
// docx sizes are half-points: 18 = 9pt, matching the PDFs' body size.
export const SIZE = { body: 18, small: 15, brand: 32, label: 14 } as const;
export const COLOR = { text: "1A1A1A", muted: "666666", faint: "888888", link: "1A4FD6" };

export const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
export const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
export const RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" };
export const HEAVY_RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 8, color: "1A1A1A" };

// A4 with the PDFs' 40pt (800 twip) margins.
export const A4_PAGE = {
  size: { width: 11906, height: 16838 },
  margin: { top: 800, bottom: 800, left: 800, right: 800 },
} as const;
const CONTENT_TWIPS = A4_PAGE.size.width - A4_PAGE.margin.left - A4_PAGE.margin.right;

// Column widths in percent → an explicit twip grid. LibreOffice ignores
// per-cell percentages, so tables carry both.
export const grid = (pcts: readonly number[]) => pcts.map((p) => Math.round((CONTENT_TWIPS * p) / 100));

export type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

export function run(
  text: string,
  opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {},
) {
  return new TextRun({
    text,
    font: FONT,
    bold: opts.bold,
    italics: opts.italics,
    size: opts.size ?? SIZE.body,
    color: opts.color ?? COLOR.text,
  });
}

export function link(url: string, text: string, size: number = SIZE.body, color: string = COLOR.link) {
  return new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text, font: FONT, size, color, underline: {} })],
  });
}

export function cell(
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

export function para(children: (TextRun | ExternalHyperlink)[], opts: { align?: Align; after?: number } = {}) {
  return new Paragraph({ children, alignment: opts.align, spacing: { after: opts.after ?? 0 } });
}

// "Page {page} of {pages}", split around the two placeholders so Word fills in
// live page fields.
export function pageOfRuns(template: string): TextRun[] {
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
