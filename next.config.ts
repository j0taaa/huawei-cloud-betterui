import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res-static.hc-cdn.cn",
      },
    ],
  },
};

export default nextConfig;
