// src/app/page.tsx
"use client";

import LandingLayout from "@/components/layouts/LandingLayout";
import HeroSection from "@/components/landing/HeroSection";
import TrustSection from "@/components/landing/TrustSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import PlatformSection from "@/components/landing/PlatformSection";
import ComplianceSection from "@/components/landing/ComplianceSection";
import TestimonialsSection from "@/components/landing/TestimonialsSection";
import PricingSection from "@/components/landing/PricingSection";
import CtaSection from "@/components/landing/CtaSection";

export default function Home() {
  return (
    <LandingLayout>
      <HeroSection />
      <TrustSection />
      <HowItWorksSection />
      <FeaturesSection />
      <PlatformSection />
      <ComplianceSection />
      <TestimonialsSection />
      <PricingSection />
      <CtaSection />
    </LandingLayout>
  );
}
