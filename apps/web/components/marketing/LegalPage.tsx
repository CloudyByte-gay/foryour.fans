import { AlertTriangle } from "lucide-react";

export interface LegalSection {
  heading: string;
  body: string;
}

/**
 * Shared scaffold for /terms, /privacy and /legal/compliance. The copy is a
 * placeholder — every one of these pages carries a visible "pending legal
 * review" note, and we don't invent legal requirements here (per
 * prompts/full.md's content policy).
 */
export function LegalPage({
  title,
  intro,
  sections,
  lastUpdated,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  lastUpdated: string;
}) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {lastUpdated}</p>

      <div
        role="note"
        className="mt-6 flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p>
          <strong className="font-semibold">Placeholder — pending legal review.</strong> This page
          is scaffolding only. The wording here has not been reviewed by a lawyer and is not the
          final policy.
        </p>
      </div>

      <p className="mt-6 text-muted">{intro}</p>

      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-xl font-semibold">{section.heading}</h2>
            <p className="mt-2 text-muted">{section.body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
