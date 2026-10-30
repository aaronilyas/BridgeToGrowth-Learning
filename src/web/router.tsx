import type { JSX } from "react";
import { Redirect, Route, Switch } from "wouter";
import { AppShell } from "./components/AppShell.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { GraphPage } from "./pages/Graph.tsx";
import { LessonPage } from "./pages/Lesson.tsx";
import { PracticePage } from "./pages/Practice.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { StatsPage } from "./pages/Stats.tsx";
import { TeachPage } from "./pages/Teach.tsx";
import { UsagePage } from "./pages/Usage.tsx";
import { useSession } from "./session.tsx";

function Loading(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={28} />
    </div>
  );
}

function Unavailable(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <p className="text-muted">The local profile could not be loaded. Check that the database is running, then reload.</p>
    </div>
  );
}

// O(1)
export function AppRouter(): JSX.Element {
  const { me } = useSession();
  if (me === undefined) return <Loading />;
  if (me === null) return <Unavailable />;
  return (
    <AppShell>
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
    </AppShell>
  );
}
