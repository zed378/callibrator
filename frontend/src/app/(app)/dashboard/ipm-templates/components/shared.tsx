"use client";

/**
 * P22-01 — the pieces every catalogue panel shares: the words for the vocabularies (Indonesian /
 * English, `ipmCatalogue.` namespace), dates in the page's language, the pager, the inline action
 * error (a 409's state explanation as the backend wrote it), and the items of a version laid out by
 * section.
 */
import React from "react";
import { Alert, Button } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import type { PageMeta } from "@/api/services/ipmCatalogue.service";
import { groupBySection, limitSymbolic, type ContentFields, type InspectionInputKind, type InspectionOutcome, type InspectionSection } from "../catalogue";

/** The page's translator plus the catalogue's vocabularies and dates in its language. */
export function useCatalogueText() {
  const { t, locale } = useI18n();
  const dates = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" });
  return {
    t,
    locale,
    section: (s: InspectionSection): string => t(`ipmCatalogue.section.${s}` as MessageKey),
    kind: (k: InspectionInputKind): string => t(`ipmCatalogue.kind.${k}` as MessageKey),
    outcome: (o: InspectionOutcome): string => t(`ipmCatalogue.outcome.${o}` as MessageKey),
    status: (s: string): string => t(`ipmCatalogue.status.${s}` as MessageKey),
    proposalKind: (k: string): string => t(`ipmCatalogue.proposalKind.${k}` as MessageKey),
    date: (value: string | null | undefined): string => (value ? dates.format(new Date(value)) : "—"),
  };
}

/** The message a failed action shows: the backend's own (a 409 explains the state), else a fallback. */
export const actionMessage = (err: unknown, fallback: string): string => describeApiError(err).message || fallback;

/** A failed action, shown in the panel (not only in a toast), with a way to dismiss it. */
export function ActionError({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div role="alert">
      <Alert variant="error" title={t("ipmCatalogue.action.failed")}>
        <p>{message}</p>
        <Button size="sm" variant="ghost" className="mt-2" onClick={onDismiss}>
          {t("ipmCatalogue.action.dismiss")}
        </Button>
      </Alert>
    </div>
  );
}

/** Previous / next over a paged list; nothing when there is one page or none. */
export function Pager({ meta, onPage, label }: { meta: PageMeta | null; onPage: (page: number) => void; label: string }) {
  const { t } = useI18n();
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-2 pt-3">
      <p className="text-sm text-muted-foreground">
        {t("ipmCatalogue.pager.status", { page: meta.page, pages: meta.totalPages, total: meta.total })}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          {t("ipmCatalogue.pager.previous")}
        </Button>
        <Button size="sm" variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          {t("ipmCatalogue.pager.next")}
        </Button>
      </div>
    </nav>
  );
}

/** The limit as the server reads it, or as written when it is printed only. */
export function LimitText({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const symbolic = limitSymbolic(text);
  return <span className="font-mono text-xs">{symbolic ?? text}</span>;
}

/** A field class for the native controls the catalogue forms use (theme tokens only). */
export const FIELD = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

interface SectionItemsProps<T extends ContentFields & { required: boolean }> {
  items: readonly T[];
  /** Extra cells at the end of each row (the editor's controls). */
  actions?: (item: T, index: number) => React.ReactNode;
  /** The header of the extra column. */
  actionsHeader?: string;
  /** Where each item sits in `items` (the editor passes rows in their own order). */
  indexOf?: (item: T) => number;
  /** A tag after the label (the base items of a published type version). */
  tag?: (item: T) => React.ReactNode;
}

/** A version's items, one table per section in the registry's order. */
export function SectionItems<T extends ContentFields & { required: boolean }>({ items, actions, actionsHeader, indexOf, tag }: SectionItemsProps<T>) {
  const text = useCatalogueText();
  const { t } = text;
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("ipmCatalogue.items.none")}</p>;
  }
  return (
    <div className="space-y-5">
      {groupBySection(items, (i) => i.section).map(([section, group]) => (
        <section key={section} aria-label={text.section(section)}>
          <h4 className="text-sm font-semibold text-foreground mb-2">
            {text.section(section)} <span className="font-normal text-muted-foreground">({group.length})</span>
          </h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.label")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.kind")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.unit")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.limit")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.required")}</th>
                  {actions && <th scope="col" className="px-3 py-2 font-medium">{actionsHeader}</th>}
                </tr>
              </thead>
              <tbody>
                {group.map((item, i) => (
                  <tr key={`${section}-${String(indexOf ? indexOf(item) : i)}`} className="border-t border-border">
                    <td className="px-3 py-2">
                      {item.label}
                      {item.symbol ? <span className="ml-1 text-muted-foreground">({item.symbol})</span> : null}
                      {tag ? tag(item) : null}
                    </td>
                    <td className="px-3 py-2">{text.kind(item.inputKind)}</td>
                    <td className="px-3 py-2">{item.unit ?? "—"}</td>
                    <td className="px-3 py-2">
                      <LimitText text={item.limitText} />
                    </td>
                    <td className="px-3 py-2">{item.required ? t("ipmCatalogue.items.yes") : t("ipmCatalogue.items.no")}</td>
                    {actions && <td className="px-3 py-2">{actions(item, indexOf ? indexOf(item) : i)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
