import { lazy, Suspense, type JSX } from "react";
import { Redirect, Route, Switch } from "wouter";
import { AppShell } from "./components/AppShell.tsx";
import { ProGate } from "./components/ProGate.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { CancelPage } from "./pages/Cancel.tsx";
import { ForgotPage } from "./pages/Forgot.tsx";
import { LessonPage } from "./pages/Lesson.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { PracticePage } from "./pages/Practice.tsx";
import { ResetPage } from "./pages/Reset.tsx";
import { SignupPage } from "./pages/Signup.tsx";
import { TeachPage } from "./pages/Teach.tsx";
import { useSession } from "./session.tsx";

// INV: pages that pull heavy code (d3-force on Graph) or that most sessions never open load as separate chunks; Teach, Lesson and Practice stay in the entry
const AccountPage = lazy(() => import("./pages/Account.tsx").then((m) => ({ default: m.AccountPage })));
const BillingPage = lazy(() => import("./pages/Billing.tsx").then((m) => ({ default: m.BillingPage })));
const GraphPage = lazy(() => import("./pages/Graph.tsx").then((m) => ({ default: m.GraphPage })));
const SettingsPage = lazy(() => import("./pages/Settings.tsx").then((m) => ({ default: m.SettingsPage })));
const StatsPage = lazy(() => import("./pages/Stats.tsx").then((m) => ({ default: m.StatsPage })));
const UsagePage = lazy(() => import("./pages/Usage.tsx").then((m) => ({ default: m.UsagePage })));

function Loading(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={28} />
    </div>
  );
}

function PageLoading(): JSX.Element {
  return (
    <div className="flex justify-center p-10">
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
      <Suspense fallback={<PageLoading />}>
        <Switch>
          <Route path="/teach" component={TeachPage} />
          <Route path="/lesson/:id" component={LessonPage} />
          <Route path="/practice" component={PracticePage} />
          <Route path="/graph" component={GraphPage} />
          <Route path="/stats" component={StatsRoute} />
          <Route path="/settings" component={SettingsRoute} />
          <Route path="/billing/cancel" component={CancelPage} />
          <Route path="/billing" component={BillingPage} />
          <Route path="/account" component={AccountPage} />
          <Route path="/usage" component={UsagePage} />
          <Route>
            <Redirect to="/teach" replace />
          </Route>
        </Switch>
      </Suspense>
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
      <Route path="/forgot">
        <PublicOnly>
          <ForgotPage />
        </PublicOnly>
      </Route>
      <Route path="/reset" component={ResetPage} />
      <Route>
        <Guarded />
      </Route>
    </Switch>
  );
}
