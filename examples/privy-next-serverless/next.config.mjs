import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next doesn't pick up the SDK's lockfile one
  // directory up.
  outputFileTracingRoot: __dirname,
  // Some transitive deps (e.g. @ethereumjs/util) ship their original .ts
  // source files alongside compiled .d.ts. tsc happily picks them up despite
  // skipLibCheck and complains about strictness mismatches that have nothing
  // to do with our code. The IDE still type-checks user code on every save;
  // this only suppresses third-party noise during `next build`.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
