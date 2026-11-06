import type { JSX } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMarkdown } from "../../shared/markdown.ts";
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
  // INV: a wide table scrolls inside its own box instead of widening the lesson column
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
};

// INV: GitHub tables, strikethrough only with ~~, autolinks and task lists; a single ~ stays a literal "approximately"
const remarkPlugins: NonNullable<Parameters<typeof ReactMarkdown>[0]["remarkPlugins"]> = [[remarkGfm, { singleTilde: false }], remarkMath];

// O(n) in text length
// INV: the same text renders the same way for every subject: tables are repaired before math is wrapped and the Markdown is parsed
export function MdBody({ text }: { text: string }): JSX.Element {
  return (
    <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={[rehypeKatex]} components={components}>
      {normalizeMarkdown(wrapBareMath(text))}
    </ReactMarkdown>
  );
}
