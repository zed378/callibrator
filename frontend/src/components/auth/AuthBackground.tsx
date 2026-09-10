// src/components/auth/AuthBackground.tsx
"use client";

import React from "react";
import AuroraBackground from "@/components/motion/AuroraBackground";

/**
 * Ambient auth-page backdrop — the same immersive aurora + blueprint grid the
 * landing hero uses, so signing in feels continuous with the marketing site.
 * Token-tinted (recolors with the tenant --primary), no WebGL, and calm under
 * prefers-reduced-motion.
 */
export function AuthBackground() {
  return <AuroraBackground />;
}

export default AuthBackground;
