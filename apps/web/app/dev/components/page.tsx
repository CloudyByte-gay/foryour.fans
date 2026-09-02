import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ComponentGallery } from "./ComponentGallery";

export const metadata: Metadata = {
  title: "Component gallery",
  robots: { index: false, follow: false },
};

/**
 * Dev-only reference page: every UI primitive rendered in both themes. Not a
 * product surface — it 404s in a production build so it never ships.
 * (prompts/web.md WEB PHASE 0 deliverables: "a single /dev/components page".)
 */
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="min-h-dvh bg-background p-6 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-bold">Component gallery</h1>
          <p className="text-sm text-muted">
            Every <code className="rounded bg-surface-muted px-1">components/ui</code> primitive, in
            light and dark. Dev-only — excluded from production builds.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-label="Light theme" className="theme-light rounded-lg border border-border bg-background p-5">
            <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Light</h2>
            <ComponentGallery />
          </section>
          <section aria-label="Dark theme" className="theme-dark rounded-lg border border-border bg-background p-5">
            <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Dark</h2>
            <ComponentGallery />
          </section>
        </div>
      </div>
    </div>
  );
}
