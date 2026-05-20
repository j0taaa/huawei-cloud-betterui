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
  allowedDevOrigins: ["hwctools.site"],
};

export default nextConfig;
