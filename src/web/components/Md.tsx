import "katex/dist/katex.min.css";
import type { JSX } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

// SEC: model output is untrusted: no raw HTML, no images, links only for http(s) and always in a new, opener-less tab
const components: Components = {
  img: () => null,
  a: ({ href, children }) => {
    let ok = false;
    try {
      ok = typeof href === "string" && ["http:", "https:"].includes(new URL(href).protocol);
    } catch {
      ok = false;
    }
    return ok ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
  },
};

// O(n) in text length
export function Md({ text, className = "" }: { text: string; className?: string }): JSX.Element {
  return (
    <div className={`md leading-relaxed ${className}`}>
      <ReactMarkdown skipHtml remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
