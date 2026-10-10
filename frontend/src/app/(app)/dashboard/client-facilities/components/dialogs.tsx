"use client";

/**
 * P22-09 — the facility administration's dialogs: the facility form (create / edit), the status
 * change (with its reason; leaving `active` signs the facility's users out), and the facility's
 * users with the binding of a user (bind, unbind with the role it keeps across every facility).
 * Every refusal is the server's explanation, shown in the dialog with what was typed kept: a
 * duplicate code (409), an `ended → active` by someone who is not a tenant administrator (403),
 * a binding while `FACILITY_BINDING_ENABLED` is off (409), a role a facility account cannot have.
 */
import React, { useEffect, useState } from "react";
import { Alert, Button, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import {
  clientFacilityService,
  type ClientFacility,
  type ClientFacilityUser,
  type RoleRow,
  type TenantUser,
} from "@/api/services/clientFacility.service";
import { deferEffect } from "@/lib/deferEffect";
import { useI18n } from "@/i18n/MessagesProvider";
import type { Messages } from "@/i18n";
import { KINDS, createBody, editBody, emptyForm, formOf, nextStatuses, problemsOf, reasonValid, type FacilityForm, type Status } from "../facilities";

export const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

export function useFacilityText() {
  const { t, locale } = useI18n();
  return {
    t,
    locale,
    kind: (k: string) => t(`facilities.kind.${k}` as keyof Messages),
    status: (s: string) => t(`facilities.status.${s}` as keyof Messages),
  };
}

function Refusal({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div role="alert">
      <Alert variant="error" title={t("facilities.refused")}>
        <p>{message}</p>
      </Alert>
    </div>
  );
}

const FIELDS: { key: keyof FacilityForm; max: number; type?: string }[] = [
  { key: "address", max: 500 },
  { key: "city", max: 100 },
  { key: "province", max: 100 },
  { key: "postalCode", max: 20 },
  { key: "phone", max: 50 },
  { key: "contactName", max: 255 },
  { key: "contactEmail", max: 255, type: "email" },
  { key: "contactPhone", max: 50 },
];

export function FacilityFormDialog({ facility, onClose }: { facility: ClientFacility | null; onClose: (saved: ClientFacility | null) => void }) {
  const text = useFacilityText();
  const { t } = text;
  const creating = facility === null;
  const [before] = useState<FacilityForm>(() => (facility ? formOf(facility) : emptyForm()));
  const [form, setForm] = useState<FacilityForm>(before);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const body = creating ? createBody(form) : editBody(form, before);
  const problems = problemsOf(body, creating);
  const nothing = !creating && Object.keys(body).length === 0;
  const set = (patch: Partial<FacilityForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShown(true);
    if (Object.keys(problems).length > 0 || nothing) return;
    setBusy(true);
    setRefusal(null);
    try {
      onClose(creating ? await clientFacilityService.create(createBody(form)) : await clientFacilityService.edit(facility.id, editBody(form, before)));
    } catch (err) {
      setRefusal(describeApiError(err).message || t("facilities.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const problem = (key: string) =>
    shown && problems[key] ? (
      <p id={`facility-${key}-problem`} className="text-xs text-destructive">
        {problems[key]}
      </p>
    ) : null;

  return (
    <Dialog isOpen onClose={() => onClose(null)} title={creating ? t("facilities.form.createTitle") : t("facilities.form.editTitle", { name: facility.name })} size="xl">
      <form noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="facility-name" className="block text-sm font-semibold">
              {t("facilities.field.name")}
            </label>
            <input id="facility-name" className={FIELD} maxLength={255} value={form.name} aria-invalid={shown && problems["name"] ? true : undefined} onChange={(e) => set({ name: e.target.value })} />
            {problem("name")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="facility-code" className="block text-sm font-semibold">
              {t("facilities.field.code")}
            </label>
            <input
              id="facility-code"
              className={`${FIELD} font-mono uppercase`}
              maxLength={32}
              value={form.code}
              aria-describedby="facility-code-help"
              aria-invalid={shown && problems["code"] ? true : undefined}
              onChange={(e) => set({ code: e.target.value })}
            />
            <p id="facility-code-help" className="text-xs text-muted-foreground">
              {t("facilities.field.codeHelp")}
            </p>
            {problem("code")}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="facility-kind" className="block text-sm font-semibold">
              {t("facilities.field.kind")}
            </label>
            <select id="facility-kind" className={FIELD} value={form.kind} onChange={(e) => set({ kind: e.target.value as FacilityForm["kind"] })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {text.kind(k)}
                </option>
              ))}
            </select>
          </div>
          {FIELDS.map(({ key, max, type }) => (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`facility-${key}`} className="block text-sm font-semibold">
                {t(`facilities.field.${key}` as keyof Messages)}
              </label>
              <input
                id={`facility-${key}`}
                type={type ?? "text"}
                className={FIELD}
                maxLength={max}
                value={form[key]}
                aria-invalid={shown && problems[key] ? true : undefined}
                onChange={(e) => set({ [key]: e.target.value })}
              />
              {problem(key)}
            </div>
          ))}
        </div>
        {shown && nothing && <p className="text-sm text-muted-foreground">{t("facilities.form.nothing")}</p>}
        <Refusal message={refusal} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onClose(null)}>
            {t("facilities.cancel")}
          </Button>
          <Button type="submit" isLoading={busy}>
            {creating ? t("facilities.form.create") : t("facilities.form.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function StatusDialog({ facility, onClose }: { facility: ClientFacility; onClose: (changed: { facility: ClientFacility; sessionsRevoked: number } | null) => void }) {
  const text = useFacilityText();
  const { t } = text;
  const options = nextStatuses(facility.status);
  const [status, setStatus] = useState<Status>(options[0] as Status);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShown(true);
    if (!reasonValid(reason)) return;
    setBusy(true);
    setRefusal(null);
    try {
      onClose(await clientFacilityService.setStatus(facility.id, { status, reason: reason.trim() }));
    } catch (err) {
      setRefusal(describeApiError(err).message || t("facilities.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen onClose={() => onClose(null)} title={t("facilities.statusDialog.title", { name: facility.name })} size="md">
      <form noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        <p className="text-sm">{t("facilities.statusDialog.current", { status: text.status(facility.status) })}</p>
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">{t("facilities.statusDialog.to")}</legend>
          {options.map((s) => (
            <label key={s} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="facility-status" value={s} checked={status === s} onChange={() => setStatus(s)} />
              {text.status(s)}
            </label>
          ))}
        </fieldset>
        {facility.status === "active" && <p className="text-sm text-status-attention">{t("facilities.statusDialog.signsOut")}</p>}
        {status === "ended" && <p className="text-sm text-muted-foreground">{t("facilities.statusDialog.ended")}</p>}
        <div className="space-y-1.5">
          <label htmlFor="facility-status-reason" className="block text-sm font-semibold">
            {t("facilities.reason")}
          </label>
          <textarea id="facility-status-reason" rows={3} className={FIELD} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          {shown && !reasonValid(reason) && <p className="text-xs text-destructive">{t("facilities.reasonInvalid")}</p>}
        </div>
        <Refusal message={refusal} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onClose(null)}>
            {t("facilities.cancel")}
          </Button>
          <Button type="submit" isLoading={busy}>
            {t("facilities.statusDialog.confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const personName = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username;

export function UsersDialog({ facility, canBind, onClose }: { facility: ClientFacility; canBind: boolean; onClose: () => void }) {
  const { t } = useFacilityText();
  const [users, setUsers] = useState<ClientFacilityUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [find, setFind] = useState("");
  const [found, setFound] = useState<TenantUser[]>([]);
  const [chosen, setChosen] = useState<TenantUser | null>(null);
  const [unbinding, setUnbinding] = useState<ClientFacilityUser | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(
    () =>
      deferEffect(async () => {
        setLoadError(null);
        try {
          setUsers(await clientFacilityService.users(facility.id));
        } catch (err) {
          setLoadError(describeApiError(err).message || t("facilities.users.failed"));
        }
      }),
    [facility.id, generation, t],
  );

  useEffect(() => {
    if (!canBind || find.trim().length < 2) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      void clientFacilityService
        .findUsers(find.trim())
        .then((list) => {
          if (active) setFound(list);
        })
        .catch(() => {
          if (active) setFound([]);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [find, canBind]);

  useEffect(() => {
    if (!unbinding) return undefined;
    return deferEffect(async () => {
      try {
        setRoles(await clientFacilityService.roles());
      } catch {
        setRoles([]);
      }
    });
  }, [unbinding]);

  const act = async () => {
    setShown(true);
    if (!reasonValid(reason) || (unbinding && !roleId)) return;
    const userId = unbinding?.id ?? chosen?.id;
    if (!userId) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await clientFacilityService.bind(userId, unbinding ? { clientFacilityId: null, roleId, reason: reason.trim() } : { clientFacilityId: facility.id, reason: reason.trim() });
      setDone(t("facilities.users.done", { count: result.sessionsRevoked }));
      setChosen(null);
      setUnbinding(null);
      setReason("");
      setRoleId("");
      setShown(false);
      setGeneration((g) => g + 1);
    } catch (err) {
      setRefusal(describeApiError(err).message || t("facilities.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const acting = chosen !== null || unbinding !== null;

  return (
    <Dialog isOpen onClose={onClose} title={t("facilities.users.title", { name: facility.name })} size="xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("facilities.users.lead")}</p>
        {loadError ? (
          <div role="alert">
            <Alert variant="error" title={t("facilities.users.failed")}>
              <p>{loadError}</p>
            </Alert>
          </div>
        ) : users === null ? (
          <p className="text-sm text-muted-foreground">{t("facilities.loading")}</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("facilities.users.none")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{personName(u)}</span> <span className="text-muted-foreground">({u.username})</span>
                </span>
                {canBind && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setChosen(null);
                      setUnbinding(u);
                      setRefusal(null);
                      setDone(null);
                    }}
                  >
                    {t("facilities.users.unbind", { name: personName(u) })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canBind && !acting && (
          <div className="space-y-2">
            <label htmlFor="facility-user-find" className="block text-sm font-semibold">
              {t("facilities.users.find")}
            </label>
            <input id="facility-user-find" type="search" className={FIELD} value={find} maxLength={100} onChange={(e) => setFind(e.target.value)} />
            {find.trim().length >= 2 && (
              <ul className="space-y-1">
                {found.length === 0 && <li className="text-xs text-muted-foreground">{t("facilities.users.noMatch")}</li>}
                {found.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="min-h-9 text-left text-sm underline underline-offset-2"
                      onClick={() => {
                        setChosen(u);
                        setRefusal(null);
                        setDone(null);
                      }}
                    >
                      {t("facilities.users.bindPick", { name: personName(u), username: u.username })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {acting && (
          <section aria-labelledby="facility-binding-heading" className="space-y-3 rounded-md border border-border p-3">
            <h3 id="facility-binding-heading" className="text-sm font-semibold">
              {unbinding ? t("facilities.users.unbindTitle", { name: personName(unbinding) }) : t("facilities.users.bindTitle", { name: chosen ? personName(chosen) : "" })}
            </h3>
            <p className="text-sm text-muted-foreground">{unbinding ? t("facilities.users.unbindLead") : t("facilities.users.bindLead")}</p>
            {unbinding && (
              <div className="space-y-1.5">
                <label htmlFor="facility-unbind-role" className="block text-sm font-semibold">
                  {t("facilities.users.role")}
                </label>
                <select id="facility-unbind-role" className={FIELD} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  <option value="">{t("facilities.users.roleChoose")}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nameToShow ?? r.name}
                    </option>
                  ))}
                </select>
                {shown && !roleId && <p className="text-xs text-destructive">{t("facilities.users.roleMissing")}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="facility-binding-reason" className="block text-sm font-semibold">
                {t("facilities.reason")}
              </label>
              <textarea id="facility-binding-reason" rows={2} className={FIELD} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              {shown && !reasonValid(reason) && <p className="text-xs text-destructive">{t("facilities.reasonInvalid")}</p>}
            </div>
            <Refusal message={refusal} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setChosen(null);
                  setUnbinding(null);
                  setShown(false);
                }}
              >
                {t("facilities.cancel")}
              </Button>
              <Button type="button" isLoading={busy} onClick={() => void act()}>
                {unbinding ? t("facilities.users.unbindConfirm") : t("facilities.users.bindConfirm")}
              </Button>
            </div>
          </section>
        )}
        {done && (
          <p role="status" className="text-sm">
            {done}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("facilities.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
