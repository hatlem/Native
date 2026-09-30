// Minimal Markdown → AST for previewing article drafts.
//
// Drafts are plain text written in the writer portal, usually with light
// Markdown (headings, emphasis, lists, links). Reviewers should see the
// article as it will read, not the raw source. We deliberately don't pull
// in a Markdown library + HTML sanitizer: the parser produces a small AST
// that <ArticlePreview> renders as React elements, so HTML in a draft is
// always shown as literal text — there is no HTML string anywhere to
// sanitize, and no dangerouslySetInnerHTML. Links are the only
// attribute-bearing output, and their hrefs go through safeExternalUrl
// (http/https/mailto/relative only); anything else renders as plain text.
//
// Supported: ATX headings (#–######), paragraphs, unordered (- * +) and
// ordered (1. / 1)) lists, blockquotes (>), horizontal rules, and inline
// **strong**/__strong__, *em*/_em_, `code` and [text](url).

import { safeExternalUrl } from "@/lib/security";

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "rule" };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/;
const UL_ITEM = /^[-*+]\s+(.*)$/;
const OL_ITEM = /^\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

// Earliest-match inline tokenizer. Each pattern is tried at every search
// position; the leftmost match wins (ties: order below), text before it
// becomes a text node, and container nodes recurse into their content.
type InlineRule = { re: RegExp; build: (m: RegExpExecArray) => Inline };
const INLINE_RULES: InlineRule[] = [
  { re: /`([^`\n]+)`/, build: (m) => ({ type: "code", value: m[1] }) },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    build: (m) => {
      const href = safeExternalUrl(m[2]);
      // Unsafe or unparseable target: keep the words, drop the link.
      return href
        ? { type: "link", href, children: parseInline(m[1]) }
        : { type: "text", value: m[1] };
    },
  },
  { re: /\*\*(?=\S)([^\n]+?)\*\*/, build: (m) => ({ type: "strong", children: parseInline(m[1]) }) },
  { re: /(?<![\w])__(?=\S)([^\n]+?)__(?![\w])/, build: (m) => ({ type: "strong", children: parseInline(m[1]) }) },
  { re: /\*(?=\S)([^*\n]+?)\*/, build: (m) => ({ type: "em", children: parseInline(m[1]) }) },
  // Word-boundary guarded so snake_case_words stay literal.
  { re: /(?<![\w])_(?=\S)([^_\n]+?)_(?![\w])/, build: (m) => ({ type: "em", children: parseInline(m[1]) }) },
];

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: { index: number; match: RegExpExecArray; rule: InlineRule } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, match: m, rule };
      }
    }
    if (!best) {
      pushText(out, rest);
      break;
    }
    if (best.index > 0) pushText(out, rest.slice(0, best.index));
    const node = best.rule.build(best.match);
    if (node.type === "text") pushText(out, node.value);
    else out.push(node);
    rest = rest.slice(best.index + best.match[0].length);
  }
  return out;
}

function pushText(out: Inline[], value: string) {
  const last = out[out.length - 1];
  if (last?.type === "text") last.value += value;
  else out.push({ type: "text", value });
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
    if (quote.length) {
      blocks.push({ type: "quote", children: parseInline(quote.join(" ")) });
      quote = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      if (!quote.length) flush();
      quote.push(q[1]);
      continue;
    }
    // A plain line directly under a list item continues that item (lazy
    // continuation); otherwise it belongs to the running paragraph.
    if (list) {
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    if (quote.length) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.value : inlineText(n.children)))
    .join("");
}

const HEADLINE_MAX = 140;

// The article's headline as a reader would see it: the first heading (a
// draft often opens with its disclosure label, so the first line alone
// isn't reliable), or failing that the first non-empty line — plain text,
// markup stripped. Null when the draft has no text. Lists use this instead
// of Article.title, which is the publication name the article was born for.
export function articleHeadline(body: string | null | undefined): string | null {
  if (!body?.trim()) return null;
  const heading = parseMarkdown(body).find((b) => b.type === "heading");
  const source =
    heading && heading.type === "heading"
      ? heading.children
      : parseInline(
          body
            .split(/\r?\n/)
            .find((l) => l.trim() !== "")!
            .trim()
            .replace(/^(?:[-*+]|\d{1,9}[.)]|>)\s+/, ""),
        );
  const text = inlineText(source).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > HEADLINE_MAX ? `${text.slice(0, HEADLINE_MAX - 1).trimEnd()}…` : text;
}
