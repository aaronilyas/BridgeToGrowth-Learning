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
    <section aria-label={title} className="text-sm">
      <h3 className="mb-1 font-semibold text-muted">{title}</h3>
      <ol className="flex flex-col gap-1">
        {citations.map((c) => {
          const label = `${c.title}${c.year === null ? "" : ` (${c.year})`}`;
          return (
            <li key={`${c.n}-${c.paperId}`} className="text-muted">
              <span className="text-accent">[{c.n}]</span>{" "}
              {c.doi ? (
                <a className="text-text underline hover:text-accent" href={doiUrl(c.doi)} target="_blank" rel="noopener noreferrer">
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
