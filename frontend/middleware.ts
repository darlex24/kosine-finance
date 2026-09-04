import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Server-side auth gate.
 *
 * `AuthProvider` still guards the client tree, but that only runs after the
 * page has already been sent. This refuses the request at the edge instead, and
 * refreshes the Supabase session cookies on the way through.
 */

const PUBLIC_ROUTES = ["/sign-in", "/sign-up"];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without configuration there is nothing to check — let the client-side gate
  // render its "cannot reach Supabase" guidance rather than looping redirects.
  if (!url || !key || url.includes("placeholder")) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies: { name: string; value: string; options?: CookieOptions }[]) => {
        cookies.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && !isPublic) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    return NextResponse.redirect(signIn);
  }

  if (user && isPublic) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
