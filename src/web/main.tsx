import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SeasonArt } from "./components/SeasonArt.tsx";
import { AppRouter } from "./router.tsx";
import { SessionProvider } from "./session.tsx";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <SessionProvider>
        <SeasonArt />
        <AppRouter />
      </SessionProvider>
    </StrictMode>,
  );
