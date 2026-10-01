"use server";
/**
 * P10-02: the language toggle's Server Action. Posted by a plain `<form>`, so
 * it works with JavaScript disabled and needs no inline script (ADR-071). The
 * cookie is HttpOnly — only the server reads it — SameSite=Lax, Secure in
 * production, one year. An unknown value falls back to the default rather than
 * being stored.
 */
import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, resolveLocale } from "./config";

export async function setLocale(formData: FormData): Promise<void> {
  const raw = formData.get("locale");
  const locale = resolveLocale(typeof raw === "string" ? raw : null);
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });
}
