import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "./markdown-content";

describe("MarkdownContent", () => {
  it("renders common chat Markdown and GFM structures", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownContent, { content: '# Result\n\n- Evidence\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst ready = true;\n```\n\n[Source](https://example.com)' }),
    );

    expect(markup).toContain("<h1>Result</h1>");
    expect(markup).toContain("<ul>");
    expect(markup).toContain("<table>");
    expect(markup).toContain('<code class="language-ts">');
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('target="_blank"');
  });

  it("does not execute raw HTML or dangerous links", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownContent, { content: '<script>alert("x")</script>\n\n[unsafe](javascript:alert("x"))' }),
    );

    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("javascript:");
  });
});
