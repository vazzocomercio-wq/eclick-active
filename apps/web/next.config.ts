import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@eclick-active/shared'],

  // Production build não bloqueia em warnings de lint — type-check
  // já é estrito (tsc --noEmit) e roda separado no CI/turbo.
  // Lint é informativo, não build-blocker.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
