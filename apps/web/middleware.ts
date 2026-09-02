import { NextResponse, type NextRequest } from "next/server";

/**
 * Server Components and layouts can't see the request path. We stamp it onto
 * a request header here so `app/(app)/layout.tsx` can build an accurate
 * `/login?next=<path>` redirect for anonymous users (requirement #1).
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
