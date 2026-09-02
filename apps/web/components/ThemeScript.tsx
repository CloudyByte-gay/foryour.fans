import { THEME_COOKIE_NAME } from "@/lib/theme";

/**
 * Runs before first paint. The server already stamps `class="dark"` on <html>
 * for an explicit `dark` preference, but for `system` (or no cookie) it can't
 * know the OS setting — this closes that gap with zero flash. Kept tiny and
 * dependency-free on purpose.
 */
export function ThemeScript() {
  const js = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE_NAME}=([^;]*)/);var p=m?decodeURIComponent(m[1]):'system';var dark=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
