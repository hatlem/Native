import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/content/markdown";

// Reader-facing rendering of an article draft. Everything is built as React
// elements from the parsed AST (see @/lib/content/markdown), so any HTML in
// a draft is escaped text by construction and link targets are already
// allow-listed. No dangerouslySetInnerHTML, no sanitizer to keep in sync.
export function ArticlePreview({ body }: { body: string }) {
  return <div className="article-preview">{parseMarkdown(body).map(renderBlock)}</div>;
}

function renderBlock(block: Block, i: number): ReactNode {
  switch (block.type) {
    case "heading": {
      // The page owns the <h1>; draft headings start one level below it.
      const level = Math.min(block.level + 1, 6);
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={i}>{renderInline(block.children)}</Tag>;
    }
    case "paragraph":
      return <p key={i}>{renderInline(block.children)}</p>;
    case "list": {
      const items = block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
      return block.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
    }
    case "quote":
      return <blockquote key={i}>{renderInline(block.children)}</blockquote>;
    case "rule":
      return <hr key={i} />;
  }
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return <code key={i}>{node.value}</code>;
      case "strong":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children)}
          </a>
        );
      case "image":
        // A writer-hosted image (absolute http(s) only, see the parser). No
        // referrer, so the host doesn't learn which review page loaded it.
        return (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host; next/image needs each host allow-listed
          <img
            key={i}
            className="article-preview__image"
            src={node.src}
            alt={node.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        );
    }
  });
}
