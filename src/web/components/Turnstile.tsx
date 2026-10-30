import { useEffect, useRef, type JSX } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; theme: "dark"; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function readTurnstile(): TurnstileApi | null {
  const t: unknown = Reflect.get(window, "turnstile");
  return typeof t === "object" && t !== null && "render" in t ? (t as TurnstileApi) : null;
}

// O(1)
// SEC: external script only, no inline script; loaded once per page
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const ready = readTurnstile();
    if (ready) return resolve(ready);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => {
      const t = readTurnstile();
      if (t) resolve(t);
      else reject(new Error("turnstile missing"));
    };
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile load failed"));
    };
    document.head.append(s);
  });
  return loading;
}

// O(1)
// INV: onToken(null) whenever the token is no longer usable; bump resetKey after each submit because tokens are single-use
export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (t: string | null) => void; resetKey: number }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let live = true;
    loadTurnstile().then(
      (t) => {
        if (!live || !box.current) return;
        const id = t.render(box.current, { sitekey: siteKey, theme: "dark", callback: (tok) => cb.current(tok), "expired-callback": () => cb.current(null), "error-callback": () => cb.current(null) });
        widget.current = { api: t, id };
      },
      () => cb.current(null),
    );
    return () => {
      live = false;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === 0 || !widget.current) return;
    cb.current(null);
    widget.current.api.reset(widget.current.id);
  }, [resetKey]);

  return <div ref={box} className="min-h-[65px]" />;
}
