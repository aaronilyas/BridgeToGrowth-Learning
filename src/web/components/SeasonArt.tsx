import type { JSX } from "react";

const LEAF = "M0 0C6-7 18-7 26 0C18 7 6 7 0 0Z";

function Flower({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }): JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy={-r} rx={r * 0.62} ry={r} fill={fill} opacity="0.92" transform={`rotate(${a})`} />
      ))}
      <circle r={r * 0.45} fill="var(--art-2)" />
    </g>
  );
}

function Leaf({ x, y, a, s = 1, fill = "var(--art-leaf)" }: { x: number; y: number; a: number; s?: number; fill?: string }): JSX.Element {
  return <path d={LEAF} fill={fill} transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`} />;
}

function Sprig({ fill, vein }: { fill: string; vein: string }): JSX.Element {
  return (
    <g>
      <path d="M0 80C14 58 26 34 44 4" stroke={vein} strokeWidth="2" fill="none" strokeLinecap="round" />
      <Leaf x={8} y={64} a={-150} s={0.9} fill={fill} />
      <Leaf x={14} y={56} a={-20} s={0.9} fill={fill} />
      <Leaf x={24} y={40} a={-160} s={0.85} fill={fill} />
      <Leaf x={28} y={32} a={-35} s={0.85} fill={fill} />
      <Leaf x={38} y={16} a={-120} s={0.75} fill={fill} />
      <Leaf x={43} y={5} a={-60} s={0.7} fill={fill} />
    </g>
  );
}

function Sun(): JSX.Element {
  return (
    <g stroke="var(--accent-2)" strokeWidth="2.5" strokeLinecap="round" fill="none">
      <circle r="11" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="0" y1="-17" x2="0" y2="-24" transform={`rotate(${a})`} />
      ))}
    </g>
  );
}

function Flake(): JSX.Element {
  return (
    <g stroke="var(--art-1)" strokeWidth="2" strokeLinecap="round" fill="none">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <line x1="0" y1="0" x2="0" y2="-22" />
          <path d="M-6-18L0-12L6-18M-4-9L0-5L4-9" />
        </g>
      ))}
    </g>
  );
}

const sway = { transformBox: "fill-box", transformOrigin: "bottom left" } as const;
const spin = { transformBox: "fill-box", transformOrigin: "center" } as const;

// O(1)
// INV: all four seasons are mounted; CSS keyed on <html data-season> shows one, so switching is a single attribute change
// SEC: inline SVG only, no external assets
export function SeasonArt(): JSX.Element {
  return (
    <>
      <div className="season-art" data-for="spring" aria-hidden="true">
        <svg style={{ left: 0, top: 0 }} width="58" height="72" viewBox="0 0 96 120">
          <g className="art-sway" style={{ ...sway, transformOrigin: "top left" }}>
            <path d="M-4 -4C18 20 22 52 10 112" stroke="var(--art-leaf)" strokeWidth="2" fill="none" />
            <Leaf x={12} y={22} a={10} s={0.9} />
            <Leaf x={18} y={42} a={170} s={0.8} />
            <Leaf x={18} y={58} a={20} s={0.85} />
            <Leaf x={14} y={80} a={160} s={0.75} />
            <Leaf x={11} y={98} a={30} s={0.7} />
          </g>
        </svg>
        <svg style={{ right: 4, bottom: 4 }} width="132" height="112" viewBox="0 0 132 112">
          <g className="art-sway" style={sway}>
            <path d="M12 108C40 92 70 78 104 30" stroke="var(--art-leaf)" strokeWidth="2" fill="none" />
            <Leaf x={40} y={92} a={-150} s={0.8} />
            <Leaf x={70} y={70} a={-30} s={0.8} />
            <Flower x={104} y={24} r={10} fill="var(--art-1)" />
            <Flower x={74} y={46} r={9} fill="var(--art-2)" />
            <Flower x={112} y={62} r={9} fill="var(--art-3)" />
            <Flower x={34} y={86} r={7} fill="var(--art-3)" />
            <Flower x={88} y={88} r={7} fill="var(--art-1)" />
          </g>
        </svg>
      </div>
      <div className="season-art" data-for="summer" aria-hidden="true">
        <svg style={{ left: 2, top: 2 }} width="32" height="32" viewBox="-28 -28 56 56">
          <g className="art-spin" style={spin}><Sun /></g>
        </svg>
        <svg style={{ right: 14, top: 10 }} width="48" height="48" viewBox="-28 -28 56 56">
          <g className="art-spin" style={spin}><Sun /></g>
        </svg>
      </div>
      <div className="season-art" data-for="fall" aria-hidden="true">
        <svg style={{ left: 2, top: 2, transform: "scaleY(-1)" }} width="34" height="52" viewBox="0 0 56 86">
          <g className="art-sway" style={sway}><Sprig fill="var(--art-1)" vein="var(--art-1)" /></g>
        </svg>
        <svg style={{ right: 2, top: 2, transform: "scale(-1,-1)" }} width="34" height="52" viewBox="0 0 56 86">
          <g className="art-sway" style={sway}><Sprig fill="var(--art-1)" vein="var(--art-1)" /></g>
        </svg>
        <svg style={{ left: 2, bottom: 2 }} width="34" height="52" viewBox="0 0 56 86">
          <g className="art-sway" style={sway}><Sprig fill="var(--art-leaf)" vein="var(--art-leaf)" /></g>
        </svg>
        <svg style={{ right: 2, bottom: 2, transform: "scaleX(-1)" }} width="34" height="52" viewBox="0 0 56 86">
          <g className="art-sway" style={sway}><Sprig fill="var(--art-2)" vein="var(--art-2)" /></g>
        </svg>
      </div>
      <div className="season-art" data-for="winter" aria-hidden="true">
        <svg style={{ left: 2, top: 2 }} width="32" height="32" viewBox="-24 -24 48 48">
          <g className="art-drift" style={spin}><Flake /></g>
        </svg>
        <svg style={{ right: 6, top: 6 }} width="32" height="32" viewBox="-24 -24 48 48">
          <g className="art-drift" style={spin}><Flake /></g>
        </svg>
        <svg style={{ left: 2, bottom: 2 }} width="24" height="24" viewBox="-24 -24 48 48">
          <g className="art-drift" style={spin}><Flake /></g>
        </svg>
        <svg style={{ right: 8, bottom: 8 }} width="44" height="44" viewBox="-24 -24 48 48">
          <g className="art-drift" style={spin}><Flake /></g>
        </svg>
      </div>
    </>
  );
}
