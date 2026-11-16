// Test-only DOM shim. The app never imports this module.

type DomNode = {
  nodeType: number;
  nodeName: string;
  tagName: string | undefined;
  namespaceURI: string;
  childNodes: DomNode[];
  style: Record<string, string>;
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  className: string;
  textContent: string;
  parentNode: DomNode | null;
  ownerDocument: unknown;
  addEventListener: () => void;
  removeEventListener: () => void;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
  appendChild: (child: DomNode) => DomNode;
  insertBefore: (child: DomNode, ref: DomNode | null) => DomNode;
  removeChild: (child: DomNode) => DomNode;
  contains: (child: DomNode) => boolean;
  focus: () => void;
  blur: () => void;
  firstChild?: DomNode | null;
  lastChild?: DomNode | null;
  nextSibling?: DomNode | null;
};

// O(1)
function makeNode(tag: string, type = 1): DomNode {
  const node = {
    nodeType: type,
    nodeName: type === 3 ? "#text" : String(tag).toUpperCase(),
    tagName: type === 1 ? String(tag).toUpperCase() : undefined,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: [] as DomNode[],
    style: {},
    attributes: {} as Record<string, string>,
    dataset: {},
    className: "",
    textContent: type === 3 ? String(tag) : "",
    parentNode: null as DomNode | null,
    ownerDocument: null as unknown,
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name: string, value: string) {
      node.attributes[name] = String(value);
      if (name === "class") node.className = String(value);
    },
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] ?? null : null;
    },
    removeAttribute(name: string) {
      delete node.attributes[name];
    },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(node.attributes, name);
    },
    appendChild(child: DomNode) {
      child.parentNode?.removeChild(child);
      node.childNodes.push(child);
      child.parentNode = node;
      return child;
    },
    insertBefore(child: DomNode, ref: DomNode | null) {
      child.parentNode?.removeChild(child);
      const at = ref ? node.childNodes.indexOf(ref) : -1;
      if (at < 0) node.childNodes.push(child);
      else node.childNodes.splice(at, 0, child);
      child.parentNode = node;
      return child;
    },
    removeChild(child: DomNode) {
      const at = node.childNodes.indexOf(child);
      if (at >= 0) node.childNodes.splice(at, 1);
      if (child.parentNode === node) child.parentNode = null;
      return child;
    },
    contains(child: DomNode) {
      if (child === node) return true;
      return node.childNodes.some((kid) => kid.contains(child));
    },
    focus() {},
    blur() {},
  };
  Object.defineProperty(node, "firstChild", { get: () => node.childNodes[0] ?? null });
  Object.defineProperty(node, "lastChild", { get: () => node.childNodes.at(-1) ?? null });
  Object.defineProperty(node, "nextSibling", { get: () => {
    const kids = node.parentNode?.childNodes;
    if (!kids) return null;
    return kids[kids.indexOf(node) + 1] ?? null;
  } });
  if (type === 1) Object.setPrototypeOf(node, HTMLElement.prototype);
  return node;
}

// O(1)
// INV: installs the smallest document React 19 will commit into, and only the globals those commits touch
export function installTestDom(): HTMLElement {
  const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.window = g as Window & typeof globalThis;
  if (typeof g.HTMLElement !== "function") g.HTMLElement = class HTMLElement {} as typeof HTMLElement;
  if (typeof g.Element !== "function") g.Element = class Element {} as typeof Element;
  if (typeof g.HTMLIFrameElement !== "function") g.HTMLIFrameElement = class HTMLIFrameElement {} as typeof HTMLIFrameElement;
  if (typeof g.Node !== "function") {
    g.Node = class Node {
      static ELEMENT_NODE = 1;
      static TEXT_NODE = 3;
      static COMMENT_NODE = 8;
      static DOCUMENT_NODE = 9;
    } as typeof Node;
  }
  g.navigator ??= { userAgent: "bun" } as Navigator;
  g.getSelection ??= (() => null) as typeof getSelection;
  const documentShim = {
    nodeType: 9,
    activeElement: null as DomNode | null,
    defaultView: g,
    createElement(tag: string) {
      const node = makeNode(tag);
      node.ownerDocument = documentShim;
      return node;
    },
    createElementNS(_ns: string, tag: string) {
      const node = makeNode(tag);
      node.ownerDocument = documentShim;
      return node;
    },
    createTextNode(text: string) {
      const node = makeNode(text, 3);
      node.ownerDocument = documentShim;
      node.textContent = String(text);
      return node;
    },
    createComment(text: string) {
      const node = makeNode(text, 8);
      node.ownerDocument = documentShim;
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const html = makeNode("html");
  html.ownerDocument = documentShim;
  const body = makeNode("body");
  body.ownerDocument = documentShim;
  documentShim.activeElement = body;
  g.document = documentShim as unknown as Document;
  const host = documentShim.createElement("div");
  body.appendChild(host);
  return host as unknown as HTMLElement;
}
