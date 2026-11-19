import type { MermaidConfig } from "mermaid";
import { DIAGRAM_MAX_CHARS, checkDiagram, inertDiagram } from "../../shared/visual.ts";
import { oneLine, svgDataUri } from "./cache.ts";

export type MermaidLike = { initialize: (config: MermaidConfig) => void; render: (id: string, text: string) => Promise<{ svg: string }> };
export type DiagramResult = { ok: true; uri: string } | { ok: false; error: string };

// SEC: strict mode encodes label HTML and disables click callbacks; htmlLabels false keeps labels as SVG text, never HTML; the secure keys cannot be changed from inside a diagram
export const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  theme: "neutral",
  maxTextSize: DIAGRAM_MAX_CHARS,
  maxEdges: 200,
  suppressErrorRendering: true,
  secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "flowchart", "theme", "themeVariables", "themeCSS", "fontFamily", "dompurifyConfig"],
};

const initialized = new WeakSet<MermaidLike>();
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

// O(diagram size)
// INV: resolves, never rejects; renders run one at a time because Mermaid keeps global state while it draws
// SEC: the source passes checkDiagram and loses its interaction lines first; the SVG Mermaid returns is shown only as a data: image
export function drawDiagram(source: string, mermaid: MermaidLike): Promise<DiagramResult> {
  const bad = checkDiagram(source);
  if (bad !== null) return Promise.resolve({ ok: false, error: bad });
  const job = queue.then(async (): Promise<DiagramResult> => {
    if (!initialized.has(mermaid)) {
      mermaid.initialize(MERMAID_CONFIG);
      initialized.add(mermaid);
    }
    try {
      const { svg } = await mermaid.render(`btg-diagram-${++seq}`, inertDiagram(source));
      return svg.includes("<svg") ? { ok: true, uri: svgDataUri(svg) } : { ok: false, error: "Mermaid returned no drawing." };
    } catch (e) {
      return { ok: false, error: oneLine(e instanceof Error ? e.message : "The diagram has a syntax error.") };
    }
  });
  queue = job;
  return job;
}
