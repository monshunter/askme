"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...properties }) => <a {...properties} target="_blank" rel="noreferrer noopener">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
