/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  basePath: "/lift-log",
  poweredByHeader: false,
  experimental: { cpus: 1 },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cache-Control", value: "private, no-store" }
      ]
    }];
  }
};
export default config;
