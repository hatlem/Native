import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline, articleHeadline } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings, paragraphs, lists, quotes and rules", () => {
    const blocks = parseMarkdown(
      [
        "# Big headline",
        "",
        "First line of a paragraph",
        "continues here.",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2) second",
        "",
        "> quoted",
        "",
        "---",
      ].join("\n"),
    );
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["heading", "paragraph", "list", "list", "quote", "rule"],
    );
    assert.deepEqual(blocks[1], {
      type: "paragraph",
      children: [{ type: "text", value: "First line of a paragraph continues here." }],
    });
    const [ul, ol] = [blocks[2], blocks[3]];
    assert.ok(ul.type === "list" && !ul.ordered && ul.items.length === 2);
    assert.ok(ol.type === "list" && ol.ordered && ol.items.length === 2);
  });

  it("keeps raw HTML as literal text (never markup)", () => {
    const [p] = parseMarkdown('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    assert.deepEqual(p, {
      type: "paragraph",
      children: [{ type: "text", value: '<img src=x onerror="alert(1)"> <script>alert(1)</script>' }],
    });
  });
});

describe("parseInline", () => {
  it("parses emphasis, code and nested markup", () => {
    assert.deepEqual(parseInline("a **bold _and em_** `x*y`"), [
      { type: "text", value: "a " },
      {
        type: "strong",
        children: [
          { type: "text", value: "bold " },
          { type: "em", children: [{ type: "text", value: "and em" }] },
        ],
      },
      { type: "text", value: " " },
      { type: "code", value: "x*y" },
    ]);
  });

  it("leaves snake_case words alone", () => {
    assert.deepEqual(parseInline("use snake_case_names here"), [
      { type: "text", value: "use snake_case_names here" },
    ]);
  });

  it("links only safe targets; unsafe ones degrade to their text", () => {
    assert.deepEqual(parseInline("[site](https://example.com/a)"), [
      { type: "link", href: "https://example.com/a", children: [{ type: "text", value: "site" }] },
    ]);
    // The URL pattern stops at the first ")", so the stray one stays text.
    assert.deepEqual(parseInline("[click](javascript:alert(1))"), [
      { type: "text", value: "click)" },
    ]);
  });
});

describe("articleHeadline", () => {
  it("prefers the first heading, even after a disclosure line", () => {
    assert.equal(
      articleHeadline("Annonsørinnhold\n\n# Slik kutter du **strømregningen**\n\nBody."),
      "Slik kutter du strømregningen",
    );
  });

  it("falls back to the first non-empty line", () => {
    assert.equal(articleHeadline("\n\nFirst line here\nsecond line"), "First line here");
  });

  it("returns null for empty drafts and truncates long headlines", () => {
    assert.equal(articleHeadline("   \n "), null);
    assert.equal(articleHeadline(null), null);
    const long = articleHeadline(`# ${"word ".repeat(60)}`)!;
    assert.ok(long.length <= 140 && long.endsWith("…"));
  });
});
