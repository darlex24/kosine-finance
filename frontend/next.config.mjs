/** @type {import('next').NextConfig} */

const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Receipt images are served from Supabase Storage, and the app talks to the
// Kosine API and Supabase over XHR — everything else is denied.
const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; 'unsafe-eval' is dev-only (Fast Refresh).
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: " + supabaseOrigin,
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]
  .filter(Boolean)
  .join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Stops a browser second-guessing a stored receipt's declared type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), payment=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
