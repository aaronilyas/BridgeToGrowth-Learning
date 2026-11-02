import type { JSX } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { wrapBareMath } from "../../shared/math.ts";
import { registerKatexFonts } from "../katexFonts.ts";

registerKatexFonts();

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
export function MdBody({ text }: { text: string }): JSX.Element {
  return (
    <ReactMarkdown skipHtml remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
      {wrapBareMath(text)}
    </ReactMarkdown>
  );
}
