import type { MetadataRoute } from "next";

/** Private application: disallow all crawling. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
