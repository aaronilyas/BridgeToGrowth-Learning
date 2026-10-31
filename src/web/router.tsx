import type { JSX } from "react";
import { Redirect, Route, Switch } from "wouter";
import { AppShell } from "./components/AppShell.tsx";
import { ProGate } from "./components/ProGate.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { BillingPage } from "./pages/Billing.tsx";
import { CancelPage } from "./pages/Cancel.tsx";
import { GraphPage } from "./pages/Graph.tsx";
import { LessonPage } from "./pages/Lesson.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { PracticePage } from "./pages/Practice.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { SignupPage } from "./pages/Signup.tsx";
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
      <p className="text-muted">The server could not be reached. Check your connection, then reload.</p>
    </div>
  );
}

function StatsRoute(): JSX.Element {
  return (
    <ProGate feature="Personal stats" detail="See your accuracy, retention, calibration, streaks and daily insights over time.">
      <StatsPage />
    </ProGate>
  );
}

function SettingsRoute(): JSX.Element {
  return (
    <ProGate feature="Settings" detail="Tune spaced repetition, lesson length, your daily goal, the model and the theme. The Free plan uses the defaults.">
      <SettingsPage />
    </ProGate>
  );
}

function Guarded(): JSX.Element {
  const { me, failed } = useSession();
  if (me === undefined) return <Loading />;
  if (me === null) return failed ? <Unavailable /> : <Redirect to="/login" replace />;
  return (
    <AppShell>
      <Switch>
        <Route path="/teach" component={TeachPage} />
        <Route path="/lesson/:id" component={LessonPage} />
        <Route path="/practice" component={PracticePage} />
        <Route path="/graph" component={GraphPage} />
        <Route path="/stats" component={StatsRoute} />
        <Route path="/settings" component={SettingsRoute} />
        <Route path="/billing/cancel" component={CancelPage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/usage" component={UsagePage} />
        <Route>
          <Redirect to="/teach" replace />
        </Route>
      </Switch>
    </AppShell>
  );
}

function PublicOnly({ children }: { children: JSX.Element }): JSX.Element {
  const { me } = useSession();
  if (me === undefined) return <Loading />;
  if (me) return <Redirect to="/teach" replace />;
  return children;
}

// O(1)
export function AppRouter(): JSX.Element {
  return (
    <Switch>
      <Route path="/login">
        <PublicOnly>
          <LoginPage />
        </PublicOnly>
      </Route>
      <Route path="/signup">
        <PublicOnly>
          <SignupPage />
        </PublicOnly>
      </Route>
      <Route>
        <Guarded />
      </Route>
    </Switch>
  );
}
