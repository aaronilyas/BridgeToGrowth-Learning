import type { JSX } from "react";
import { setAutoFit, setZoom, useDisplayState } from "../../zoom.ts";
import { SettingsSection, SettingsToggle } from "./controls.tsx";

// O(1)
// INV: display choices are per device (localStorage) and apply at once, so they are not part of the saved settings draft
export function DisplayFields(): JSX.Element {
  const { autoFit, zoom, calibration, display, rootPx, narrow } = useDisplayState();
  const fitted = Math.round(calibration.scale * 100);
  const limitedByWindow = calibration.byWindow < calibration.byScreen;
  return (
    <SettingsSection title="Display" hint="Applies right away on this device only.">
      <SettingsToggle label="Fit the interface to this display" checked={autoFit} onChange={setAutoFit} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Display</dt>
        <dd>
          {display.screenWidth}×{display.screenHeight} at {window.devicePixelRatio}× pixel density
        </dd>
        <dt className="text-muted">Window</dt>
        <dd>
          {display.viewportWidth}×{display.viewportHeight}
          {narrow && <span className="text-muted"> (too narrow for the sidebar, so it starts collapsed)</span>}
        </dd>
        <dt className="text-muted">Fitted size</dt>
        <dd>
          {fitted}%{limitedByWindow && <span className="text-muted"> (capped so the layout fits the window)</span>}
          {!autoFit && <span className="text-muted"> (not applied)</span>}
        </dd>
        <dt className="text-muted">Text size</dt>
        <dd>
          {rootPx.toFixed(1)}px base, zoom {Math.round(zoom * 100)}%
          {zoom !== 1 && (
            <button type="button" className="ml-2 text-accent underline" onClick={() => setZoom(1)}>
              reset zoom
            </button>
          )}
        </dd>
      </dl>
    </SettingsSection>
  );
}
