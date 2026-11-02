import { lazy, Suspense, type JSX } from "react";
import { Redirect, Route, Switch } from "wouter";
import { AppShell } from "./components/AppShell.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { LessonPage } from "./pages/Lesson.tsx";
import { PracticePage } from "./pages/Practice.tsx";
import { TeachPage } from "./pages/Teach.tsx";

// INV: pages that pull heavy code (d3-force on Graph) or that most sessions never open load as separate chunks; Teach, Lesson and Practice stay in the entry
const GraphPage = lazy(() => import("./pages/Graph.tsx").then((m) => ({ default: m.GraphPage })));
const SettingsPage = lazy(() => import("./pages/Settings.tsx").then((m) => ({ default: m.SettingsPage })));
const StatsPage = lazy(() => import("./pages/Stats.tsx").then((m) => ({ default: m.StatsPage })));
const UsagePage = lazy(() => import("./pages/Usage.tsx").then((m) => ({ default: m.UsagePage })));

function PageLoading(): JSX.Element {
  return (
    <div className="flex justify-center p-10">
      <Spinner size={28} />
    </div>
  );
}

// O(1)
export function AppRouter(): JSX.Element {
  return (
    <AppShell>
      <Suspense fallback={<PageLoading />}>
        <Switch>
          <Route path="/teach" component={TeachPage} />
          <Route path="/lesson/:id" component={LessonPage} />
          <Route path="/practice" component={PracticePage} />
          <Route path="/graph" component={GraphPage} />
          <Route path="/stats" component={StatsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/usage" component={UsagePage} />
          <Route>
            <Redirect to="/teach" replace />
          </Route>
        </Switch>
      </Suspense>
    </AppShell>
  );
}
