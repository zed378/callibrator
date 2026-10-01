"use client";
/**
 * P10-02: hands a server-picked subset of the dictionary to client components
 * (the sign-in, request-access and reset forms, the verification page). Server
 * components read the dictionary directly and never need this.
 *
 * Outside a provider the context falls back to the full ENGLISH dictionary in
 * development and tests (unit tests render client components on their own).
 * P10-13 (ADR-098 Amendment 2): NOT in a production build, where the fallback
 * is empty (a key renders as itself). Importing `en` here put the whole English
 * dictionary into every public page's JavaScript for a branch no page takes:
 * every public page wraps its client islands in a provider with the request's
 * locale (default Indonesian).
 */
import React, { createContext, useContext, useMemo } from "react";
import { createTranslator, type Messages, type Translate } from "./translate";
import type { Locale } from "./config";

interface I18nValue {
  locale: Locale;
  t: Translate;
}

const developmentFallback = (): Partial<Messages> =>
  // A static condition: the bundler drops the require from production output.
  process.env.NODE_ENV === "production"
    ? {}
    : // eslint-disable-next-line @typescript-eslint/no-require-imports -- a conditional import the production build must be able to eliminate; an ES import cannot be conditional
      (require("./messages/en") as typeof import("./messages/en")).en;

const I18nContext = createContext<I18nValue>({ locale: "en", t: createTranslator(developmentFallback()) });

export function MessagesProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Partial<Messages>;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(() => ({ locale, t: createTranslator(messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18nValue => useContext(I18nContext);
