import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from "react";
import { parseScene, type Scene } from "../../shared/visual.ts";
import { Slider } from "../components/Slider.tsx";
import { captionAt, compileScene, frameAt, geomOf, morphGeom, type Compiled } from "./sceneFrame.ts";
import { AxesShape, GeomShape } from "./sceneShapes.tsx";
import { VisualError } from "./VisualFrame.tsx";

const REDUCED = "(prefers-reduced-motion: reduce)";
const HOLD_MS = 1500;

// O(1)
function subscribeMotion(onChange: () => void): () => void {
  const mq = globalThis.matchMedia?.(REDUCED);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

// O(1)
function readReducedMotion(): boolean {
  return globalThis.matchMedia?.(REDUCED).matches ?? false;
}

// O(objects × samples) per frame
// INV: the frame is a pure function of (done, t, manual), so stepping back or forward always shows the same picture
function SceneCanvas({ c, done, t, manual }: { c: Compiled; done: number; t: number; manual: Readonly<Record<string, number>> }): JSX.Element {
  const base = frameAt(c, done, t);
  const s = { ...base, params: { ...base.params, ...manual } };
  const m = s.morph;
  const first = c.scene.steps.find((st) => st.caption)?.caption;
  return (
    <svg viewBox={`0 0 ${c.view.width} ${c.view.height}`} className="block h-auto w-full" role="img" aria-label={first ? `Animation: ${first}` : "Animation"}>
      {c.scene.objects.map((o) => {
        if (o.type === "axes") return (s.opacity[o.id] ?? 0) > 0 ? <g key={o.id} opacity={s.opacity[o.id]}><AxesShape o={o} view={c.view} /></g> : null;
        const g = geomOf(c, o, s);
        const props = { o, view: c.view, draw: s.draw[o.id] ?? 1, pulse: s.pulse[o.id] ?? 0 };
        if (m && o.id === m.id) {
          const target = c.scene.objects.find((x) => x.id === m.target);
          const tg = target ? geomOf(c, target, s) : null;
          const mixed = tg ? morphGeom(g, tg, m.t) : null;
          if (mixed) return <GeomShape key={o.id} {...props} g={mixed} opacity={1} />;
          return <GeomShape key={o.id} {...props} g={g} opacity={1 - m.t} />;
        }
        if (m && o.id === m.target) {
          const src = c.scene.objects.find((x) => x.id === m.id);
          const blend = src ? morphGeom(geomOf(c, src, s), g, m.t) : null;
          return blend ? null : <GeomShape key={o.id} {...props} g={g} opacity={m.t} />;
        }
        return <GeomShape key={o.id} {...props} g={g} opacity={s.opacity[o.id] ?? 0} />;
      })}
    </svg>
  );
}

// O(1) per frame while playing
// INV: state lives in React only and nothing is read from or written to storage; with reduced motion each step jumps to its final frame
export function ScenePlayer({ scene }: { scene: Scene }): JSX.Element {
  const c = useMemo(() => compileScene(scene), [scene]);
  const reduced = useSyncExternalStore(subscribeMotion, readReducedMotion, () => false);
  const total = scene.steps.length;
  const [done, setDone] = useState(0);
  const [t, setT] = useState(0);
  const [mode, setMode] = useState<"idle" | "all" | "one">("idle");
  const [manual, setManual] = useState<Record<string, number>>({});

  useEffect(() => {
    if (mode === "idle") return;
    const step = scene.steps[done];
    if (!step) {
      setMode("idle");
      return;
    }
    if (reduced) {
      const id = setTimeout(() => setDone((d) => Math.min(total, d + 1)), Math.max(HOLD_MS, step.duration * 1000));
      return () => clearTimeout(id);
    }
    const ms = step.duration * 1000;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const p = ms <= 0 ? 1 : (now - start) / ms;
      if (p < 1) {
        setT(p);
        raf = requestAnimationFrame(tick);
        return;
      }
      setT(0);
      setDone((d) => Math.min(total, d + 1));
      if (mode === "one") setMode("idle");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, done, reduced, scene, total]);

  const play = (): void => {
    setManual({});
    setT(0);
    const from = done >= total ? 0 : done;
    if (reduced) setDone(Math.min(total, from + 1));
    else setDone(from);
    setMode(reduced && from + 1 >= total ? "idle" : "all");
  };
  const pause = (): void => {
    setMode("idle");
    setT(0);
  };
  const forward = (): void => {
    setManual({});
    if (done >= total) return;
    if (reduced || mode !== "idle") {
      setMode("idle");
      setT(0);
      setDone(done + 1);
    } else setMode("one");
  };
  const back = (): void => {
    setManual({});
    setMode("idle");
    setT(0);
    setDone(Math.max(0, t > 0 ? done : done - 1));
  };
  const caption = captionAt(scene, done, reduced ? 0 : t);
  const base = frameAt(c, done, reduced ? 0 : t).params;
  const btn = "rounded-md border border-border px-2.5 py-1 font-mono text-xs text-text hover:bg-panel-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <figure className="visual my-4 rounded-lg border border-border bg-panel p-3">
      <SceneCanvas c={c} done={done} t={reduced ? 0 : t} manual={manual} />
      <figcaption className="mt-2 min-h-[1.5em] text-sm text-muted" aria-live="polite">{caption ?? ""}</figcaption>
      {total > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mode === "all" ? <button type="button" className={btn} onClick={pause}>Pause</button> : <button type="button" className={btn} onClick={play}>{done >= total ? "Replay" : "Play"}</button>}
          <button type="button" className={btn} onClick={back} disabled={done === 0 && t === 0} aria-label="Step back">◀ Step</button>
          <button type="button" className={btn} onClick={forward} disabled={done >= total} aria-label="Step forward">Step ▶</button>
          <span className="font-mono text-xs text-muted">{Math.min(done, total)} / {total}</span>
        </div>
      )}
      {(scene.params ?? []).map((p) => (
        <div key={p.name} className="mt-2">
          <Slider label={p.label ?? p.name} min={p.min} max={p.max} step={p.step} value={manual[p.name] ?? base[p.name] ?? p.min} format={(v) => String(Number(v.toPrecision(4)))} onChange={(v) => {
            setMode("idle");
            setT(0);
            setManual((m) => ({ ...m, [p.name]: v }));
          }} />
        </div>
      ))}
    </figure>
  );
}

// O(n) in source length
// INV: a scene that fails the strict schema shows its first issue and the source; it is parsed once per source
export function SceneView({ source }: { source: string }): JSX.Element {
  const r = useMemo(() => parseScene(source), [source]);
  if (!r.ok) return <VisualError kind="scene" message={r.error} source={source} />;
  return <ScenePlayer scene={r.scene} />;
}
