/**
 * ADR-131 (P10-18): the root layout of the PUBLIC surface — the landing,
 * sign-in, request access, forgot password, invitation, certificate
 * verification, blog and news. It owns <html>/<body> through the shared
 * RootDocument and imports only the public sheet (app/public.css): the
 * dashboard's Tailwind sheet is no longer render-blocking here. The signed-in
 * application has its own root layout (app/(app)/layout.tsx); crossing between
 * the two (sign-in, sign-out) is a full document load.
 *
 * No client providers (ADR-098 Am. 2): each public page brings the little it
 * needs (MessagesProvider inside AuthShell, the theme toggle island).
 */
import type { Metadata } from "next";
import "../public.css";
import { PUBLIC_FONT_VARIABLES } from "../fonts/publicVariables";
import { ROOT_METADATA, RootDocument } from "../rootDocument";

export const metadata: Metadata = ROOT_METADATA;

/** P7-08, ADR-071: rendered per request (the CSP nonce); see app/rootDocument.tsx. */
export const instant = false;

export default function PublicRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <RootDocument fontVariables={PUBLIC_FONT_VARIABLES} bodyClassName="min-h-full flex flex-col">
      {children}
    </RootDocument>
  );
}
