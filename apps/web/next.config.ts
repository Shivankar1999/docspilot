import path from 'node:path';
import type { NextConfig } from 'next';

// Read at build time for the rewrite below, so Docker passes it as a build arg.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // A self-contained server (only the files it needs) for a small Docker image.
  output: 'standalone',
  // Monorepo: trace dependencies from the repo root, where node_modules is hoisted.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),

  // Upload size limit shown (and checked) in the browser; must match the API's
  // MAX_UPLOAD_MB. Vercel Functions reject request bodies over 4.5 MB.
  env: {
    MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB ?? (process.env.VERCEL ? '4' : '10'),
  },

  // Proxy /api/* to Express, so the browser only ever talks to this origin:
  // the session cookie is first-party and no CORS setup is needed.
  // On Vercel, vercel.json routes /api/* to the API service before Next.js sees it.
  async rewrites() {
    if (process.env.VERCEL) return [];
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },

  // Clickjacking protection: no other site may put the dashboard in a frame.
  // /widget is the exception; proxy.ts gives it a per-tenant frame-ancestors list.
  async headers() {
    return [
      {
        source: '/((?!widget).*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
