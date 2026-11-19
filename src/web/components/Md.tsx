import "katex/dist/katex.min.css";
import { lazy, Suspense, type JSX } from "react";
import { limitVisuals } from "../../shared/visual.ts";
import { MdBlocks } from "./MdBlocks.tsx";

// INV: the markdown + KaTeX renderer is a separate chunk; its fetch starts when this module loads, so it is off the entry's critical path but usually ready by first use
// INV: the stylesheet stays in the entry CSS bundle so rendered math is never unstyled; its fonts are registered by MdBody (katexFonts.ts), before any math renders
const renderer = import("./MdBody.tsx");
const LazyMdBody = lazy(() => renderer.then((m) => ({ default: m.MdBody })));

// O(n) in text length
// SEC: until the renderer loads, the text shows as a plain React text node, which is escaped
// INV: a settled message (streaming false) is one MdBody, so output matches pre-split rendering
// INV: while streaming, only the last split block's text changes; completed blocks keep their text so memoised MdBody skips them
// INV: visuals is set only where the text is a model-authored explanation: tutor turns and question explanations, never stems or choices
// INV: the one-visual limit applies to the whole message before it is split, so a streaming reply never shows two visuals across blocks
export function Md({ text, className = "", streaming = false, visuals = false }: { text: string; className?: string; streaming?: boolean; visuals?: boolean }): JSX.Element {
  const shown = visuals ? limitVisuals(text) : text;
  return (
    <div className={`md leading-relaxed ${className}`}>
      <Suspense fallback={<p className="whitespace-pre-wrap">{shown}</p>}>
        {streaming ? <MdBlocks text={shown} visuals={visuals} Body={LazyMdBody} /> : <LazyMdBody text={shown} visuals={visuals} />}
      </Suspense>
    </div>
  );
}
