import "katex/dist/katex.min.css";
import { lazy, Suspense, type JSX } from "react";

// INV: the markdown + KaTeX renderer is a separate chunk; its fetch starts when this module loads, so it is off the entry's critical path but usually ready by first use
// INV: the stylesheet stays in the entry CSS bundle so rendered math is never unstyled
const renderer = import("./MdBody.tsx");
const LazyMdBody = lazy(() => renderer.then((m) => ({ default: m.MdBody })));

// O(n) in text length
// SEC: until the renderer loads, the text shows as a plain React text node, which is escaped
export function Md({ text, className = "" }: { text: string; className?: string }): JSX.Element {
  return (
    <div className={`md leading-relaxed ${className}`}>
      <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
        <LazyMdBody text={text} />
      </Suspense>
    </div>
  );
}
