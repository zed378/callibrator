// src/components/layouts/Footer.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Shield } from "lucide-react";

export function Footer() {
  // Resolved after mount — reading the current year during render is
  // non-deterministic and not allowed during prerender in Next 16.
  const [year, setYear] = React.useState<number | null>(null);
  // Resolve the current year after mount — reading it during render is
  // disallowed during prerender (Next 16).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setYear(new Date().getFullYear()), []);

  return (
    <footer className="border-t border-border/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-linear-to-br from-primary to-accent rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-foreground">
                Device Calibrator
              </span>
            </div>
            <p className="max-w-sm leading-relaxed text-muted-foreground">
              Streamline your medical device calibration management with our
              comprehensive enterprise platform.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4 text-foreground">
              Product
            </h4>
            <ul className="space-y-3">
              {["Features", "Compliance", "Platform", "Pricing"].map((item) => (
                <li key={item}>
                  <a
                    href={`#${item.toLowerCase().replace(" ", "-")}`}
                    className="transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4 text-foreground">
              Support
            </h4>
            <ul className="space-y-3">
              {["Documentation", "API Reference", "Community", "Contact"].map(
                (item) => (
                  <li key={item}>
                    <a
                      href="#"
                    className="transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {item}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider mb-4 text-foreground">
              Company
            </h4>
            <ul className="space-y-3">
              {[
                { label: "About Us", href: "#" },
                { label: "Careers", href: "#" },
                { label: "Blog", href: "/blog" },
                { label: "News", href: "/news" },
                { label: "Partners", href: "#" },
              ].map((item) =>
                item.href.startsWith("/") ? (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ) : (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className="transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {item.label}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        {/* Bottom */}
          <div className="mt-16 pt-8 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {year} Device Calibrator. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="#"
              className="transition-colors text-muted-foreground hover:text-foreground"
            >
              Privacy Policy
            </a>
            <a
              href="#"
              className="transition-colors text-muted-foreground hover:text-foreground"
            >
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
