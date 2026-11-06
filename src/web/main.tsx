import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionsProvider } from "./connections.tsx";
import { AppRouter } from "./router.tsx";
import { SessionProvider } from "./session.tsx";
import { installZoom } from "./zoom.ts";

installZoom();

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <SessionProvider>
        <ConnectionsProvider>
          <AppRouter />
        </ConnectionsProvider>
      </SessionProvider>
    </StrictMode>,
  );
