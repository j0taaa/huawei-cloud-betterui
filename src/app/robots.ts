import type { MetadataRoute } from "next";

const siteUrl = "https://ui.hwctools.site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/login"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
