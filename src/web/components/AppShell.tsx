import { useState, type JSX, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Sidebar, SidebarToggle } from "./Sidebar.tsx";
import { StaleModelBanner } from "./settings/StaleModelBanner.tsx";
import { ZoomControl } from "./ZoomControl.tsx";

const KEY = "btg:sidebar-collapsed";

// O(1)
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// O(1)
// INV: a collapsed sidebar leaves a slim rail with the toggle, so nothing floats over page content
// INV: the lesson route fills the main area itself (no padding, no scroll here); every other route scrolls inside a padded, width-capped column
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const set = (next: boolean): void => {
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the toggle still works for this session
    }
  };
  const isLesson = location.startsWith("/lesson/");
  return (
    <div className="relative flex h-screen">
      {collapsed ? (
        <div className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border pt-3 pb-3">
          <SidebarToggle onClick={() => set(false)} label="Show sidebar" />
          <ZoomControl vertical />
        </div>
      ) : (
        <Sidebar onCollapse={() => set(true)} />
      )}
      <main className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <StaleModelBanner />
        {isLesson ? (
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : (
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl px-8 pt-8 pb-10">{children}</div>
          </div>
        )}
      </main>
    </div>
  );
}
