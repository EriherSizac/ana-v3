import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El lint corre como paso propio (npm run lint) en CI.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
