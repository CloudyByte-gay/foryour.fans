import Link from "next/link";
import { Button } from "@/components/ui";
import type { OwnCreatorSummary, SessionState } from "@/lib/session";
import { MobileNav, type NavLink } from "./MobileNav";
import { UserMenu } from "./UserMenu";
import { Wordmark } from "./Wordmark";

interface HeaderProps {
  /** Resolved on the server by the calling layout (requirement #2). */
  session: SessionState;
  /** The viewer's own creator account, if any — drives the "Create" link. */
  creator: OwnCreatorSummary | null;
}

/**
 * The one app header, in its two variants (requirement #2). It takes an
 * already-resolved session as a prop so it stays a plain (non-async)
 * component and the correct variant is in the first HTML — no flash.
 */
export function Header({ session, creator }: HeaderProps) {
  const isAuthed = session.status === "authenticated" && session.user !== null;
  const isCreator = creator !== null;

  const links: NavLink[] = isAuthed
    ? [
        { href: "/feed", label: "Feed" },
        { href: "/discover", label: "Discover" },
        ...(isCreator ? [{ href: "/creator/posts", label: "Create" }] : []),
      ]
    : [{ href: "/discover", label: "Discover" }];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <div className="flex items-center gap-2">
          <MobileNav links={links} />
          <Wordmark />
        </div>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isAuthed && session.user ? (
            <UserMenu user={session.user} isCreator={isCreator} />
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/become-a-creator">Become a creator</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
