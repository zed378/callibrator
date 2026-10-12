"use client";
/**
 * P22-10c2 — Settings / offline mode (P19-08 § 3.2, § 6, § 11, § 13):
 *  - a browser below the floor is told what it lacks; offline mode is opt-in;
 *  - "Prepare this phone": the facilities (a bound user: its own; an unbound one: up to three), their
 *    sizes BEFORE downloading (a facility above the cap is refused with the server's words), then the
 *    download with its progress; persistent storage requested, the grant and the quota shown;
 *  - "Turn off offline mode": refused while the outbox holds anything;
 *  - another user's data blocks enabling (AM-23); an unbound tenant administrator may wipe it after
 *    typing WIPE (recorded first, ADR-135);
 *  - an update waiting is applied only on the user's word; how to install, per platform.
 */
import React, { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import type { RegistryRow } from "../../engine/registry";
import type { FieldFacility } from "../../app/fieldApi";
import { mayWipe } from "../../app/runtime";
import type { SizedFacility } from "../../app/workingSet";
import { MAX_UNBOUND_FACILITIES } from "../../app/workingSet";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { FIELD_INPUT } from "./common";

const MB = 1024 * 1024;

export function SettingsScreen() {
  const { t } = useFieldText();
  const phase = useField((s) => s.phase);
  const online = useField((s) => s.online);
  const missing = useField((s) => s.missing);
  const user = useField((s) => s.user);

  return (
    <section className="space-y-4">
      <ScreenTitle>{t("field.settings.title")}</ScreenTitle>
      {missing.length > 0 && (
        <Alert variant="warning" title={t("field.settings.unsupportedTitle")}>
          <p>{t("field.settings.unsupported", { features: missing.join(", ") })}</p>
        </Alert>
      )}
      {!user && <p className="text-sm text-muted-foreground">{online ? t("field.settings.noUser") : t("field.settings.needsConnection")}</p>}
      {user && phase === "setup" && missing.length === 0 && <Prepare />}
      {phase === "ready" && <Ready />}
      {user && mayWipe(user) && <Wipe />}
      <Install />
    </section>
  );
}

function Prepare() {
  const { t } = useFieldText();
  const api = useFieldStoreApi();
  const online = useField((s) => s.online);
  const user = useField((s) => s.user);
  const blocked = useField((s) => s.blockedByOther);
  const download = useField((s) => s.download);
  const [facilities, setFacilities] = useState<FieldFacility[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sized, setSized] = useState<SizedFacility[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bound = user?.clientFacilityId ?? null;

  const load = async () => {
    setBusy(true);
    const list = await api.getState().listFacilities();
    setFacilities(list);
    if (bound) setChosen(list.filter((f) => f.id === bound).map((f) => f.id));
    setBusy(false);
  };
  const size = async () => {
    setBusy(true);
    setSized(await api.getState().size((facilities ?? []).filter((f) => chosen.includes(f.id))));
    setBusy(false);
  };
  const start = async () => {
    if (!sized) return;
    setBusy(true);
    const outcome = await api.getState().prepare(sized);
    setProblem(outcome);
    setBusy(false);
  };

  if (blocked) {
    return (
      <Alert variant="warning" title={t("field.settings.blockedTitle")}>
        <p>{t("field.settings.blocked")}</p>
      </Alert>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-base font-semibold">{t("field.settings.prepareTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("field.settings.prepareLead")}</p>
        {!online && <p className="text-sm">{t("field.settings.needsConnection")}</p>}
        {facilities === null ? (
          <Button onClick={() => void load()} disabled={!online || busy} isLoading={busy}>
            {t("field.settings.chooseFacilities")}
          </Button>
        ) : facilities.length === 0 ? (
          <p className="text-sm">{t("field.settings.noFacilities")}</p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{bound ? t("field.settings.ownFacility") : t("field.settings.pickFacilities", { max: MAX_UNBOUND_FACILITIES })}</legend>
            {facilities.map((f) => (
              <label key={f.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={chosen.includes(f.id)}
                  disabled={bound !== null || (!chosen.includes(f.id) && chosen.length >= MAX_UNBOUND_FACILITIES)}
                  onChange={(e) => {
                    setSized(null);
                    setChosen(e.target.checked ? [...chosen, f.id] : chosen.filter((id) => id !== f.id));
                  }}
                />
                {f.name} ({f.code})
              </label>
            ))}
            <Button variant="outline" onClick={() => void size()} disabled={!online || busy || chosen.length === 0}>
              {t("field.settings.checkSize")}
            </Button>
          </fieldset>
        )}
        {sized && (
          <div className="space-y-2">
            <ul className="space-y-1 text-sm">
              {sized.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.name}</span>: {f.total === null ? f.refusal : t("field.home.devices", { count: f.total })}
                </li>
              ))}
            </ul>
            <Button onClick={() => void start()} disabled={!online || busy || sized.some((f) => f.total === null)} isLoading={download !== null}>
              {t("field.settings.download")}
            </Button>
          </div>
        )}
        {download && (
          <p role="status" className="text-sm">
            {t("field.settings.progress", { done: download.done, total: download.total })}
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {t(`field.settings.problem.${problem}` as "field.settings.problem.failed")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Ready() {
  const { t } = useFieldText();
  const api = useFieldStoreApi();
  const storage = useField((s) => s.storage);
  const updateReady = useField((s) => s.updateReady);
  const syncing = useField((s) => s.syncing);
  const outbox = useField((s) => s.status?.outbox ?? 0);
  const [refused, setRefused] = useState<number | null>(null);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-base font-semibold">{t("field.settings.readyTitle")}</h2>
        <p className="text-sm">{storage?.persisted ? t("field.settings.persisted") : t("field.settings.notPersisted")}</p>
        {storage?.usage !== null && storage?.usage !== undefined && storage.quota !== null && (
          <p className="text-sm text-muted-foreground">{t("field.settings.quota", { used: Math.round(storage.usage / MB), quota: Math.round(storage.quota / MB) })}</p>
        )}
        {!storage?.persisted && outbox > 0 && <p className="text-sm">{t("field.settings.evictionWarning")}</p>}
        {updateReady && (
          <div className="space-y-2">
            <p className="text-sm">{t("field.settings.updateReady")}</p>
            <Button onClick={() => api.getState().applyUpdate()} disabled={syncing}>
              {t("field.settings.updateNow")}
            </Button>
          </div>
        )}
        <Button
          variant="outline"
          onClick={() =>
            void api
              .getState()
              .turnOff()
              .then((r) => setRefused(r.refused ? r.pending : null))
          }
        >
          {t("field.settings.turnOff")}
        </Button>
        {refused !== null && (
          <p role="alert" className="text-sm">
            {t("field.settings.turnOffRefused", { count: refused })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Wipe() {
  const { t } = useFieldText();
  const api = useFieldStoreApi();
  const online = useField((s) => s.online);
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const wipe = async () => {
    if (!target) return;
    const r = await api.getState().wipe(target);
    setResult(r.done ? t("field.wipe.done", { captures: r.captures, photos: r.photos }) : t(`field.wipe.refused.${r.reason}` as "field.wipe.refused.offline"));
    setTarget(null);
    setTyped("");
    setRows(await api.getState().otherUsers());
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-base font-semibold">{t("field.wipe.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("field.wipe.lead")}</p>
        {rows === null ? (
          <Button variant="outline" onClick={() => void api.getState().otherUsers().then(setRows)}>
            {t("field.wipe.show")}
          </Button>
        ) : rows.length === 0 ? (
          <p className="text-sm">{t("field.wipe.none")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{t("field.wipe.row", { n: i + 1, count: r.outboxCount })}</span>
                <Button size="sm" variant="danger" onClick={() => setTarget(r.key)} aria-label={t("field.wipe.rowAction", { n: i + 1 })}>
                  {t("field.wipe.action")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {target && (
          <div className="space-y-2">
            <label htmlFor="field-wipe-confirm" className="block text-sm font-semibold">
              {t("field.wipe.confirmLabel")}
            </label>
            <input id="field-wipe-confirm" className={FIELD_INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            {!online && <p className="text-sm">{t("field.wipe.refused.offline")}</p>}
            <Button variant="danger" disabled={typed !== "WIPE" || !online} onClick={() => void wipe()}>
              {t("field.wipe.confirm")}
            </Button>
          </div>
        )}
        {result && (
          <p role="status" className="text-sm">
            {result}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Install() {
  const { t } = useFieldText();
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="text-base font-semibold">{t("field.install.title")}</h2>
        <p className="text-sm">{t("field.install.android")}</p>
        <p className="text-sm">{t("field.install.ios")}</p>
        <p className="text-sm text-muted-foreground">{t("field.install.lock")}</p>
      </CardContent>
    </Card>
  );
}
