import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MdBody } from "../components/MdBody.tsx";
import { DiagramFigure } from "./DiagramView.tsx";
import { MERMAID_CONFIG, drawDiagram, type MermaidLike } from "./diagram.ts";

const html = (text: string, visuals = true): string => renderToStaticMarkup(createElement(MdBody, { text, visuals }));

test("an unclosed visual fence renders a placeholder and never shows or runs its source", () => {
  const out = html("The curve rises.\n\n```plot\nimport numpy as np\nx = np.linspace(0, 1, 50)\nplt.plot(x, x**2");
  expect(out).toContain("Drawing the plot");
  expect(out).not.toContain("linspace");
  expect(out).not.toContain("<pre");
  expect(out).toContain("<p>The curve rises.</p>");
});

test("a closed visual fence goes to the visual renderer, not a code block", () => {
  const out = html("See.\n\n```scene\n{\"width\": 300}\n```\n\nNext.");
  expect(out).not.toContain("<pre");
  expect(out).not.toContain("width");
  expect(out).toContain("Drawing the animation");
  expect(out).toContain("<p>Next.</p>");
});

test("outside lesson and question prose, a visual fence stays a code block", () => {
  const out = html("```plot\nplt.plot([0, 1])\n```", false);
  expect(out).toContain("<pre>");
  expect(out).toContain("plt.plot");
});

test("a second visual in one message is dropped while it streams", () => {
  const out = html("```diagram\nflowchart TD\n  A --> B\n```\n\nThen:\n\n```plot\nplt.plot([0, 1])\n```\n\n> ```scene\n> {}\n> ```");
  expect(out.match(/Drawing the/g)?.length).toBe(1);
  expect(out).toContain("Drawing the diagram");
  expect(out).not.toContain("plt.plot");
});

const HOSTILE = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="javascript:alert(1)"><text onclick="alert(1)">A</text></a><foreignObject><img src="x" onerror="alert(1)"/></foreignObject></svg>';

test("Mermaid runs in strict mode with SVG text labels, and those settings cannot be changed from a diagram", () => {
  expect(MERMAID_CONFIG.securityLevel).toBe("strict");
  expect(MERMAID_CONFIG.htmlLabels).toBe(false);
  expect(MERMAID_CONFIG.flowchart?.htmlLabels).toBe(false);
  expect(MERMAID_CONFIG.startOnLoad).toBe(false);
  for (const key of ["securityLevel", "htmlLabels", "flowchart", "themeCSS", "dompurifyConfig"]) expect(MERMAID_CONFIG.secure ?? []).toContain(key);
});

test("a diagram with an HTML label and click directives renders inertly", async () => {
  const seen: string[] = [];
  const configs: unknown[] = [];
  const fake: MermaidLike = {
    initialize: (c) => void configs.push(c),
    render: async (_id, text) => {
      seen.push(text);
      return { svg: HOSTILE };
    },
  };
  const source = 'flowchart TD\n  A["<img src=x onerror=alert(1)><b>bold</b>"] --> B\n  click A href "javascript:alert(1)"\n  click B call alert(1)\n  B --> C';
  const r = await drawDiagram(source, fake);
  expect(configs).toEqual([MERMAID_CONFIG]);
  expect(seen[0]).not.toContain("click");
  expect(seen[0]).toContain("B --> C");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
  expect(Buffer.from(r.uri.slice(r.uri.indexOf(",") + 1), "base64").toString("utf8")).toBe(HOSTILE);
  const out = renderToStaticMarkup(createElement(DiagramFigure, { uri: r.uri }));
  expect(out.match(/<[a-z]+/g)).toEqual(["<figure", "<img"]);
  for (const bad of ["<script", "onclick", "onerror", "javascript:", "<a ", "foreignObject"]) expect(out).not.toContain(bad);
});

test("a diagram that changes Mermaid's configuration is refused before Mermaid sees it", async () => {
  const seen: string[] = [];
  const fake: MermaidLike = { initialize: () => undefined, render: async (_id, text) => (seen.push(text), { svg: "<svg></svg>" }) };
  const r = await drawDiagram('%%{init: {"securityLevel": "loose", "htmlLabels": true}}%%\nflowchart TD\n  A --> B', fake);
  expect(r.ok).toBe(false);
  expect(seen).toEqual([]);
});
