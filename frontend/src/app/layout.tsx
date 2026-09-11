import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { AuthInitializer } from "@/components/AuthInitializer";
import { TenantBrandingProvider } from "@/components/TenantBrandingProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastContainer } from "@/components/ui/ToastContainer";

// Canonical fonts, bundled via next/font (no CDN). Exposed as CSS variables
// referenced by the `--font-sans` / `--font-mono` theme tokens in globals.css.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

// Display face for headings (Clinical Precision direction). Referenced by the
// `--font-display` theme token in globals.css → the `font-display` utility.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Pre-hydration theme script: applies the persisted light/dark choice to
// <html> before first paint so there is no flash (replaces the old
// render-null-until-initialized hack in ThemeContext).
const themeInitScript = `(function(){try{var t=localStorage.getItem('hdc-theme-preference');if(t==='dark'){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Hospital Device Callibrator",
  description: "Medical device calibration management system",
  // Served from frontend/public/. The Next starter's favicon.ico used to sit
  // in this directory and won on the app-dir file convention, so /favicon.ico
  // returned the default icon no matter what this said; apple-touch-icon.png
  // was declared here and 404'd because nothing shipped it.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/brand/app-icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <ThemeInitScript script={themeInitScript} />
        <ThemeProvider>
          <TenantBrandingProvider>
            <AuthInitializer />
            <ToastContainer />
            {children}
          </TenantBrandingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
