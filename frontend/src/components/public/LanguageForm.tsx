/**
 * P10-02 (doc 20 §5 item 3): the language toggle. A plain `<form>` posting to
 * the `setLocale` Server Action — works with JavaScript disabled, no inline
 * script, no client state. Each option is named in its own language (never a
 * flag) and carries `lang`; the current one is marked `aria-current`.
 */
import React from "react";
import { setLocale } from "@/i18n/actions";
import type { Locale } from "@/i18n/config";
import type { Translate } from "@/i18n";

const OPTIONS: ReadonlyArray<{ locale: Locale; key: "pub.lang.id" | "pub.lang.en" }> = [
  { locale: "id", key: "pub.lang.id" },
  { locale: "en", key: "pub.lang.en" },
];

export function LanguageForm({ locale, t }: { locale: Locale; t: Translate }) {
  return (
    // The name is on a group, not the form: a named form is a landmark, and the
    // header and footer both carry this toggle (axe landmark-unique).
    <form action={setLocale}>
      <div role="group" aria-label={t("pub.lang.label")} className="inline-flex items-center rounded-md border border-pub-border-strong p-0.5">
      {OPTIONS.map((o) => {
        const current = o.locale === locale;
        return (
          <button
            key={o.locale}
            type="submit"
            name="locale"
            value={o.locale}
            lang={o.locale}
            aria-current={current ? "true" : undefined}
            className={`min-h-9 whitespace-nowrap rounded-[4px] px-2.5 text-[0.8125rem] font-medium transition-colors ${
              current ? "bg-pub-raised text-pub-text" : "text-pub-muted hover:text-pub-text"
            }`}
          >
            {t(o.key)}
            {current ? <span className="sr-only"> ({t("pub.lang.current")})</span> : null}
          </button>
        );
      })}
      </div>
    </form>
  );
}

export default LanguageForm;
