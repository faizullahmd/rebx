import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* reload config with videos schema */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.rebx.app" }],
        destination: "https://rebx.app/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
