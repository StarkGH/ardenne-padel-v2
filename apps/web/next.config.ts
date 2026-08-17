import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image de production minimale (Dockerfile) — copie uniquement les fichiers
  // réellement nécessaires à l'exécution plutôt que tout node_modules.
  output: "standalone",
};

export default nextConfig;
