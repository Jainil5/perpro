import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,

  /**
   * MyOS is no longer a separate surface: its screens took the canonical URLs
   * and the old PerPro screens moved to /legacy. Everything under the retired
   * /os prefix 308-moves to its canonical path (`/os/tasks?task=1` →
   * `/tasks?task=1`, `/os` → `/`). Permanent, because the whole tree moved.
   */
  async redirects() {
    return [
      { source: '/os', destination: '/', permanent: true },
      { source: '/os/:path*', destination: '/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
