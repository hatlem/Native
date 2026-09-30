import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline, articleHeadline, countImages } from "./markdown";

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

describe("images", () => {
  it("parses ![caption](https://…) as an image, ahead of the link it contains", () => {
    assert.deepEqual(parseInline("See ![Fleet at dawn](https://cdn.example.com/a.jpg)"), [
      { type: "text", value: "See " },
      { type: "image", src: "https://cdn.example.com/a.jpg", alt: "Fleet at dawn" },
    ]);
  });

  it("keeps only absolute http(s) sources; anything else stays caption text", () => {
    for (const src of ["javascript:void", "/uploads/a.png", "data:image/png;base64,AAAA", "mailto:x@y.z"]) {
      assert.deepEqual(parseInline(`![cap](${src})`), [{ type: "text", value: "cap" }], src);
    }
  });

  it("counts images wherever they sit, and headlines read their caption", () => {
    const body = [
      "# Title ![logo](https://x.test/l.png)",
      "",
      "Intro ![a](https://x.test/a.png) and **bold ![b](https://x.test/b.png)**",
      "",
      "- item ![c](https://x.test/c.png)",
      "> quote ![d](http://x.test/d.png)",
      "",
      "![unsafe](javascript:alert(1))",
    ].join("\n");
    assert.equal(countImages(body), 5);
    assert.equal(articleHeadline("# Fleet ![logo](https://x.test/l.png)"), "Fleet logo");
  });
});
