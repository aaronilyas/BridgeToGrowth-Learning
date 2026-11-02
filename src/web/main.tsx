import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SeasonArt } from "./components/SeasonArt.tsx";
import { ConnectionsProvider } from "./connections.tsx";
import { AppRouter } from "./router.tsx";
import { SessionProvider } from "./session.tsx";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <SessionProvider>
        <ConnectionsProvider>
          <SeasonArt />
          <AppRouter />
        </ConnectionsProvider>
      </SessionProvider>
    </StrictMode>,
  );
