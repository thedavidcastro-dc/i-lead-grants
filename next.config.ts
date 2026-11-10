import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal app: every page reads the session, so render dynamically.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
