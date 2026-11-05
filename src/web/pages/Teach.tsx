import type { JSX } from "react";
import { AskBar } from "../components/AskBar.tsx";

// O(1)
// INV: sessions live in the sidebar; this page is only the start screen
export function TeachPage(): JSX.Element {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-[12vh]">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="display text-4xl">What do you want to learn?</h1>
        <p className="text-sm text-muted">Your tutor will teach in short steps and ask you questions along the way.</p>
      </header>
      <AskBar />
    </div>
  );
}
