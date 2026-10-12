"use client";
/**
 * P22-10c2 — the field app (P19-08 § 3): ONE document, `/field`, whose screens are client state
 * (`nav.ts`). The shell: the outbox count and the connection on EVERY screen (ADR-127 § 7), the
 * screen's `<h1>` focused and announced on each change, one `<main>`. The data comes from the
 * encrypted store through the field store — never from a server render (the shell holds no tenant
 * data; `fieldShellNoTenantData.guard`). Links out of the field app are full navigations and need
 * a connection.
 *
 * Sync triggers (§ 9.3): start, `online`, the page becoming visible, "Sync now", and the worker's
 * Background Sync message (`cf-sync`); iOS has none of the last, so it syncs while open.
 */
import React, { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { createFieldStore, type StoreDeps } from "./fieldStore";
import { FieldStoreProvider, useField, useFieldStoreApi, useFieldText } from "./context";
import { go, useRoute, type View } from "./nav";
import { HomeScreen } from "./screens/HomeScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { DeviceScreen } from "./screens/DeviceScreen";
import { warmStatic } from "../platform/serviceWorker";

/**
 * The screens a visit does not open first load on demand (ADR-127 Am. 4: the `/field` first load
 * stays within its 170 KB budget). The capture screen alone would add ~70 KB (it reaches zod through
 * the IPM contracts). The warm-up below fetches every one of them through the worker, so that they
 * are there offline.
 */
const LAZY = {
  capture: () => import("./screens/CaptureScreen"),
  settings: () => import("./screens/SettingsScreen"),
  register: () => import("./screens/RegisterScreen"),
  outbox: () => import("./screens/OutboxScreen"),
  sign: () => import("./screens/SignScreen"),
  scanner: () => import("@/app/(app)/dashboard/ipm/components/QrScanner"),
} as const;
const CaptureScreen = React.lazy(() => LAZY.capture().then((m) => ({ default: m.CaptureScreen })));
const SettingsScreen = React.lazy(() => LAZY.settings().then((m) => ({ default: m.SettingsScreen })));
const RegisterScreen = React.lazy(() => LAZY.register().then((m) => ({ default: m.RegisterScreen })));
const OutboxScreen = React.lazy(() => LAZY.outbox().then((m) => ({ default: m.OutboxScreen })));
const SignScreen = React.lazy(() => LAZY.sign().then((m) => ({ default: m.SignScreen })));

/** Warm the worker's cache once it controls the page (P19-08 § 4.3). */
export const warmUp = async (): Promise<number> => {
  if (!navigator.serviceWorker?.controller) return 0;
  await Promise.all(Object.values(LAZY).map((load) => load()));
  return warmStatic(
    typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("resource").map((e) => e.name) : [],
    (url) => fetch(url, { credentials: "same-origin" }),
  );
};

export function FieldApp({ deps }: { deps: () => StoreDeps }) {
  const [store] = useState(() => createFieldStore(deps()));
  useEffect(() => {
    void store.getState().boot();
    const online = () => store.getState().setOnline(true);
    const offline = () => store.getState().setOnline(false);
    const visible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void store.getState().syncNow("visible");
    };
    const fromWorker = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === "cf-sync") void store.getState().syncNow("background-sync");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    navigator.serviceWorker?.addEventListener("message", fromWorker);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
      navigator.serviceWorker?.removeEventListener("message", fromWorker);
      store.getState().close();
    };
  }, [store]);
  return (
    <FieldStoreProvider store={store}>
      <Shell />
    </FieldStoreProvider>
  );
}

const NAV: readonly { view: View; key: "field.nav.home" | "field.nav.scan" | "field.nav.outbox" | "field.nav.settings" }[] = [
  { view: "home", key: "field.nav.home" },
  { view: "scan", key: "field.nav.scan" },
  { view: "outbox", key: "field.nav.outbox" },
  { view: "settings", key: "field.nav.settings" },
];

function Shell() {
  const { t } = useFieldText();
  const route = useRoute();
  const phase = useField((s) => s.phase);
  const online = useField((s) => s.online);
  const outbox = useField((s) => s.status?.outbox ?? 0);
  const attention = useField((s) => s.status?.attention ?? 0);
  const error = useField((s) => s.error);
  const api = useFieldStoreApi();

  useEffect(() => {
    if (phase === "ready" && online) void warmUp().catch(() => undefined);
  }, [phase, online]);

  let screen: React.ReactNode;
  if (phase === "booting") screen = <Loading />;
  else if (phase === "offline_empty") screen = <OfflineEmpty />;
  else if (phase === "setup" && route.view !== "settings") screen = <SettingsScreen />;
  else {
    switch (route.view) {
      case "settings":
        screen = <SettingsScreen />;
        break;
      case "scan":
        screen = <ScanScreen />;
        break;
      case "device":
        screen = <DeviceScreen id={route.id} />;
        break;
      case "register":
        screen = <RegisterScreen />;
        break;
      case "capture":
        screen = <CaptureScreen localId={route.ref} />;
        break;
      case "outbox":
        screen = <OutboxScreen />;
        break;
      case "sign":
        screen = <SignScreen />;
        break;
      default:
        screen = <HomeScreen />;
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <p className="font-display text-base font-semibold">{t("field.appName")}</p>
          <div className="flex items-center gap-2 text-xs">
            <StatusBadge domain="fieldConnection" state={online ? "online" : "offline"}>
              {online ? t("field.online") : t("field.offline")}
            </StatusBadge>
            <a
              href="/field?view=outbox"
              onClick={(e) => {
                e.preventDefault();
                go("outbox");
              }}
              className="rounded-full bg-muted px-2 py-1 font-medium text-foreground"
            >
              {t("field.outboxBadge", { count: outbox })}
              {attention > 0 ? ` · ${t("field.attentionBadge", { count: attention })}` : ""}
            </a>
          </div>
        </div>
        <nav aria-label={t("field.nav.label")} className="mx-auto max-w-2xl px-2 pb-2">
          <ul className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <li key={item.view}>
                <a
                  href={`/field?view=${item.view}`}
                  aria-current={route.view === item.view ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.view);
                  }}
                  className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
                    route.view === item.view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {t(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {error && (
          <div role="alert">
            <Alert variant="error" title={t("field.error.title")}>
              <p>{t(`field.error.${error.key}` as "field.error.sync")}</p>
              {error.detail && <p className="text-xs">{error.detail}</p>}
              <button type="button" className="mt-2 text-sm underline" onClick={() => api.setState({ error: null })}>
                {t("field.error.dismiss")}
              </button>
            </Alert>
          </div>
        )}
        <React.Suspense fallback={<Loading />}>{screen}</React.Suspense>
      </main>
    </div>
  );
}

/** A screen's title: focused and announced when the screen changes (P19-08 § 3.1). */
export function ScreenTitle({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} aria-live="polite" className="font-display text-xl font-semibold outline-none">
      {children}
    </h1>
  );
}

function Loading() {
  const { t } = useFieldText();
  return (
    <section aria-busy="true">
      <ScreenTitle>{t("field.loading")}</ScreenTitle>
      <p className="text-sm text-muted-foreground">{t("field.loadingLead")}</p>
    </section>
  );
}

function OfflineEmpty() {
  const { t } = useFieldText();
  return (
    <section>
      <ScreenTitle>{t("field.offlineEmpty.title")}</ScreenTitle>
      <p className="text-sm text-muted-foreground">{t("field.offlineEmpty.lead")}</p>
    </section>
  );
}
