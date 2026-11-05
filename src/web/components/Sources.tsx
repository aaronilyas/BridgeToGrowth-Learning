import type { JSX } from "react";
import type { Citation } from "../../shared/api.ts";

// O(1)
// SEC: the link is rebuilt from a bare DOI on the doi.org origin, so a stored value can never smuggle another scheme or host
function doiUrl(doi: string): string {
  return `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;
}

// O(n)
export function Sources({ citations, title = "Sources" }: { citations: Citation[]; title?: string }): JSX.Element | null {
  if (citations.length === 0) return null;
  return (
    <section aria-label={title} className="text-xs leading-relaxed">
      <h3 className="label mb-1">{title}</h3>
      <ol className="flex flex-col gap-0.5">
        {citations.map((c) => {
          const label = `${c.title}${c.year === null ? "" : ` (${c.year})`}`;
          return (
            <li key={`${c.n}-${c.paperId}`} className="text-muted">
              <span className="font-mono">[{c.n}]</span>{" "}
              {c.doi ? (
                <a className="text-muted underline decoration-border underline-offset-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent" href={doiUrl(c.doi)} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              ) : (
                label
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
