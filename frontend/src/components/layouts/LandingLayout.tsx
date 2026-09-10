// src/components/layouts/LandingLayout.tsx
"use client";

import React, { Suspense } from "react";
import AnimatedBackground from "./AnimatedBackground";
import Navigation from "./Navigation";
import Footer from "./Footer";
import ScrollReveal from "@/components/landing/_shared/ScrollReveal";
import SmoothScroll from "@/components/motion/SmoothScroll";

interface LandingLayoutProps {
  children: React.ReactNode;
}

export const LandingLayout: React.FC<LandingLayoutProps> = ({ children }) => {
  return (
    <SmoothScroll>
      <div className="min-h-screen relative">
        <AnimatedBackground />
        <ScrollReveal />
        <Suspense fallback={null}>
          <Navigation />
        </Suspense>
        <main className="relative z-10">{children}</main>
        <Footer />
      </div>
    </SmoothScroll>
  );
};

export default LandingLayout;
