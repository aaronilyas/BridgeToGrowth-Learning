import type { Element, Parents, Root, RootContent } from "hast";
import { toText } from "hast-util-to-text";
import rehypeKatex, { type Options } from "rehype-katex";
import { SKIP, visitParents } from "unist-util-visit-parents";
import type { VFile } from "vfile";

// INV: 256 covers a few revisited lessons of a few dozen expressions each, and bounds memory if a transcript keeps introducing new TeX
export const MATH_HAST_CAP = 256;

type Scope = { parent: Parents; scope: Element; value: string; display: boolean };

const renderMiss = rehypeKatex();
const cache = new Map<string, RootContent[]>();
let misses = 0;

// O(1)
function keyOf(value: string, display: boolean): string {
  return `${display ? "d" : "i"}\0${value}`;
}

// O(n) in the hast node
function cloneHast<T>(value: T): T {
  return structuredClone(value);
}

// O(n) in the hast node
// INV: cached nodes stay frozen, so a render that mutates its own tree cannot change the next one
function freezeHast(node: RootContent): void {
  if (node.type === "element") {
    const names = node.properties.className;
    if (Array.isArray(names)) Object.freeze(names);
    Object.freeze(node.properties);
    Object.freeze(node.children);
    for (const child of node.children) freezeHast(child);
  }
  Object.freeze(node);
}

// O(1)
function recall(key: string): RootContent[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return cloneHast(hit);
}

// O(1) amortized
// INV: the map stays at most MATH_HAST_CAP entries; the least recently used entry is dropped
function remember(key: string, nodes: RootContent[]): RootContent[] {
  const stored = cloneHast(nodes);
  for (const node of stored) freezeHast(node);
  Object.freeze(stored);
  cache.delete(key);
  cache.set(key, stored);
  while (cache.size > MATH_HAST_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return cloneHast(stored);
}

// O(1)
function classesOf(element: Element): string[] {
  const names = element.properties.className;
  if (!Array.isArray(names)) return [];
  const out: string[] = [];
  for (const name of names) if (typeof name === "string") out.push(name);
  return out;
}

// O(1)
// INV: display mode follows rehype-katex 7.0.1, including a fenced ```math block, which replaces the <pre>
function scopeOf(element: Element, parents: Parents[]): Scope | null {
  const classes = classesOf(element);
  const languageMath = classes.includes("language-math");
  const mathDisplay = classes.includes("math-display");
  const mathInline = classes.includes("math-inline");
  if (!languageMath && !mathDisplay && !mathInline) return null;
  let parent: Parents | undefined = parents[parents.length - 1];
  let scope = element;
  let display = mathDisplay;
  if (element.tagName === "code" && languageMath && parent?.type === "element" && parent.tagName === "pre") {
    scope = parent;
    parent = parents[parents.length - 2];
    display = true;
  }
  if (!parent) return null;
  return { parent, scope, value: toText(scope, { whitespace: "pre" }), display };
}

// O(n) in the inserted hast
function replace(parent: Parents, scope: Element, nodes: readonly RootContent[]): void {
  const children = parent.children as RootContent[];
  const index = children.indexOf(scope);
  if (index < 0) return;
  children.splice(index, 1, ...nodes);
}

// O(1) on a hit; on a miss, one KaTeX render plus one HTML-to-hast parse
// SEC: misses go through rehype-katex 7.0.1 with its default options, so trust stays off and the only inserted markup is KaTeX's
// INV: the direct katex 0.19 dependency emits different class names than rehype-katex's nested KaTeX 0.16, so a miss is rendered by rehype-katex itself
function nodesFor(scope: Scope, file: VFile): RootContent[] {
  const key = keyOf(scope.value, scope.display);
  const hit = recall(key);
  if (hit) return hit;
  const sandbox: Root = { type: "root", children: [cloneHast(scope.scope)] };
  misses++;
  renderMiss(sandbox, file);
  return remember(key, sandbox.children);
}

// O(n) in the tree, with a miss only for each new (TeX, display mode) pair
// SEC: trust is never enabled; model TeX cannot inject HTML, and a cache hit replays KaTeX's markup only
// INV: the same TeX and display mode reuse one hast tree across renders, up to MATH_HAST_CAP entries
export function rehypeKatexMemo(options?: Readonly<Options> | null): (tree: Root, file: VFile) => undefined {
  if (options && Object.keys(options).length > 0) return rehypeKatex(options);
  return (tree, file) => {
    visitParents(tree, "element", (element, parents) => {
      const scope = scopeOf(element, parents);
      if (!scope) return;
      replace(scope.parent, scope.scope, nodesFor(scope, file));
      return SKIP;
    });
    return undefined;
  };
}

// O(1)
export function mathHastMisses(): number {
  return misses;
}

// O(1)
export function storedMathHast(tex: string, display: boolean): readonly RootContent[] | null {
  return cache.get(keyOf(tex, display)) ?? null;
}

// O(1)
export function resetMathHastCache(): void {
  cache.clear();
  misses = 0;
}
