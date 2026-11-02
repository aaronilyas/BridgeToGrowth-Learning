import { useEffect, useRef, type JSX } from "react";
import { Link } from "wouter";
import type { AdsConfig } from "../../shared/api.ts";
import { useSession } from "../session.tsx";

type AdsWindow = Window & { adsbygoogle?: unknown[] };

const SCRIPT_ID = "adsbygoogle-js";

// O(1)
// INV: Google's loader is inserted at most once per document; 'strict-dynamic' trusts it because this nonced bundle inserts it
function loadAdsScript(client: string): void {
  if (document.getElementById(SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

function AdUnit({ ads }: { ads: AdsConfig }): JSX.Element {
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    loadAdsScript(ads.client);
    const w = window as AdsWindow;
    (w.adsbygoogle = w.adsbygoogle ?? []).push({});
  }, [ads.client]);
  return <ins className="adsbygoogle block min-h-[200px] w-full" data-ad-client={ads.client} data-ad-slot={ads.slot} data-ad-format="auto" data-full-width-responsive="true" />;
}

// O(1)
// INV: render only for free users; the shell omits it for pro, so a paid session never loads Google's script
export function AdSlot(): JSX.Element | null {
  const ads = useSession().config?.ads ?? null;
  if (!ads) return null;
  return (
    <aside aria-label="Advertisement" className="rounded-xl border border-border bg-panel-2 p-2">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] uppercase tracking-wide text-muted">
        <span>Ad</span>
        <Link href="/billing" className="normal-case hover:text-text">
          Remove ads with Pro
        </Link>
      </div>
      <AdUnit ads={ads} />
    </aside>
  );
}
