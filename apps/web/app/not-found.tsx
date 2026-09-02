import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";
import { Wordmark } from "@/components/shell/Wordmark";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-4 text-center">
      <Wordmark />
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist or may have moved."
        action={
          <Button asChild size="sm">
            <Link href="/">Back to home</Link>
          </Button>
        }
        className="w-full"
      />
    </div>
  );
}
