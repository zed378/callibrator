"use client";
/**
 * P22-10c2 — the field store's React binding: one store per app instance, read with a selector.
 */
import React, { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import type { FieldStoreState } from "./fieldStore";

const FieldStoreContext = createContext<StoreApi<FieldStoreState> | null>(null);

export function FieldStoreProvider({ store, children }: { store: StoreApi<FieldStoreState>; children: React.ReactNode }) {
  return <FieldStoreContext.Provider value={store}>{children}</FieldStoreContext.Provider>;
}

export function useFieldStoreApi(): StoreApi<FieldStoreState> {
  const store = useContext(FieldStoreContext);
  if (!store) throw new Error("useField outside FieldStoreProvider");
  return store;
}

/** A slice of the field state (keep selectors to primitives or stable references). */
export function useField<T>(selector: (s: FieldStoreState) => T): T {
  return useStore(useFieldStoreApi(), selector);
}

/** The field app's words (`field.` namespace) and its dates, in the page's language. */
export function useFieldText() {
  const { t, locale } = useI18n();
  const tag = locale === "id" ? "id-ID" : "en-GB";
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
  return {
    t,
    locale,
    tk: (key: string, values?: Record<string, string | number>): string => t(key as MessageKey, values),
    when: (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return "—";
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
    },
  };
}
