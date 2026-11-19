import { memo, useMemo, type JSX } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMarkdown } from "../../shared/markdown.ts";
import { wrapBareMath } from "../../shared/math.ts";
import { firstVisual, limitVisuals, type Fence } from "../../shared/visual.ts";
import { Visual } from "../visual/Visual.tsx";
import { VisualPending } from "../visual/VisualFrame.tsx";
import { registerKatexFonts } from "../katexFonts.ts";
import { rehypeKatexMemo } from "./rehypeKatexMemo.ts";

registerKatexFonts();

// SEC: model output is untrusted: no raw HTML (skipHtml, no rehype-raw), no images, links only for http(s) and always in a new, opener-less tab. The only injected markup is KaTeX's, with trust left off.
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
const rehypePlugins: NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]> = [rehypeKatexMemo];

// O(1)
// INV: only the admitted fence (the first visual, matched by its opening line) becomes a visual; any other plot, scene or diagram fence stays a code block
// SEC: a closed fence goes to the Visual renderers, which put only app-generated output in the page; an unclosed one is a placeholder and its source is never run
function withVisual(visual: Fence | null): Components {
  const kind = visual?.kind ?? null;
  if (visual === null || kind === null) return components;
  return {
    ...components,
    pre: ({ node, ...rest }) => {
      if (node?.position?.start.line !== visual.line) return <pre {...rest} />;
      return visual.closed ? <Visual kind={kind} source={visual.body} /> : <VisualPending kind={kind} />;
    },
  };
}

// O(n) in text length
// INV: the same text renders the same way for every subject: tables are repaired before math is wrapped and the Markdown is parsed
// INV: visuals true (a tutor turn or a question explanation) renders at most one visual; every other caller sees fences as code
// INV: the components object changes only when the admitted fence does, so a playing scene is not remounted while later text streams in
export const MdBody = memo(function MdBody({ text, visuals = false }: { text: string; visuals?: boolean }): JSX.Element {
  const source = normalizeMarkdown(wrapBareMath(visuals ? limitVisuals(text) : text));
  const visual = visuals ? firstVisual(source) : null;
  const key = visual === null ? "" : `${visual.line}:${visual.closed ? 1 : 0}:${visual.kind ?? ""}:${visual.body}`;
  const comps = useMemo(() => withVisual(visual), [key]);
  return (
    <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={comps}>
      {source}
    </ReactMarkdown>
  );
});
