import type { JSX } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { AppShell } from "./components/AppShell.tsx";
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

// O(1)
// INV: plan "none" may only reach billing, usage and settings
export function isOpenWithoutPlan(path: string): boolean {
  return path === "/billing" || path.startsWith("/billing/") || path === "/usage" || path === "/settings";
}

function Loading(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={28} />
    </div>
  );
}

function Guarded(): JSX.Element {
  const { me } = useSession();
  const [location] = useLocation();
  if (me === undefined) return <Loading />;
  if (me === null) return <Redirect to="/login" replace />;
  if (me.entitlement.plan === "none" && !isOpenWithoutPlan(location)) return <Redirect to="/billing" replace />;
  return (
    <AppShell>
      <Switch>
        <Route path="/teach" component={TeachPage} />
        <Route path="/lesson/:id" component={LessonPage} />
        <Route path="/practice" component={PracticePage} />
        <Route path="/graph" component={GraphPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/billing/*?" component={BillingPage} />
        <Route path="/usage" component={UsagePage} />
        <Route path="/cancel" component={CancelPage} />
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
        <PublicOnly><LoginPage /></PublicOnly>
      </Route>
      <Route path="/signup">
        <PublicOnly><SignupPage /></PublicOnly>
      </Route>
      <Route>
        <Guarded />
      </Route>
    </Switch>
  );
}
