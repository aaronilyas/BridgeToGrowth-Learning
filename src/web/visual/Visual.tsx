import { lazy, Suspense, type ComponentType, type JSX } from "react";
import type { VisualKind } from "../../shared/visual.ts";
import { VisualError, VisualPending } from "./VisualFrame.tsx";

type ViewProps = { source: string };

// O(1)
// INV: a renderer chunk that fails to load becomes an error row, so a visual never throws into the lesson
function lazyView(load: () => Promise<ComponentType<ViewProps>>, kind: VisualKind): ComponentType<ViewProps> {
  return lazy(() =>
    load().then(
      (view) => ({ default: view }),
      () => ({ default: ({ source }: ViewProps) => <VisualError kind={kind} message="The renderer could not load." source={source} /> }),
    ),
  );
}

// INV: each renderer is its own chunk, fetched the first time a visual of that kind appears
const VIEWS: Record<VisualKind, ComponentType<ViewProps>> = {
  plot: lazyView(() => import("./PlotView.tsx").then((m) => m.PlotView), "plot"),
  scene: lazyView(() => import("./ScenePlayer.tsx").then((m) => m.SceneView), "scene"),
  diagram: lazyView(() => import("./DiagramView.tsx").then((m) => m.DiagramView), "diagram"),
};

// O(1) plus the renderer
// INV: a failure stays inside this box; the prose around it, the turn marker and any check are unaffected
export function Visual({ kind, source }: { kind: VisualKind; source: string }): JSX.Element {
  const View = VIEWS[kind];
  return (
    <Suspense fallback={<VisualPending kind={kind} />}>
      <View source={source} />
    </Suspense>
  );
}
