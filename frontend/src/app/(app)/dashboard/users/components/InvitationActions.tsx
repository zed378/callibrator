"use client";

import React, { useCallback, useId, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import type { User } from "@/types";
import { Alert, Button, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { userService, type UserInvitationState } from "@/api/services/user.service";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n/MessagesProvider";

const FIELD =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

interface InvitationActionsProps {
  user: User;
  /** Called after an issue or a revoke, so the list can refresh. */
  onChanged?: () => void;
}

const nameOf = (user: User) => user.username || user.email;

/**
 * P24-09c (ADR-139 § 3, Am. 1) — the invitation of an imported account, from its row on the users
 * page (only rows awaiting one). The dialog reads the state (GET /users/:id/invitation) and offers:
 *  - "Send invitation" / "Send again" (POST; a live one stops working), with the person's first and
 *    last name when the account is a shared one;
 *  - "Withdraw" (DELETE) when one is live.
 * Until the platform operator opens the organisation, it says so and offers nothing. A refusal is
 * shown in the server's own words. The token is never seen here: it goes out by e-mail only.
 */
export const InvitationActions: React.FC<InvitationActionsProps> = ({ user, onChanged }) => {
  const { t, locale } = useI18n();
  const addToast = useToastStore((s) => s.addToast);
  const ids = { first: useId(), last: useId() };
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UserInvitationState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setState(await userService.getInvitation(user.id));
    } catch {
      setLoadFailed(true);
    }
  }, [user.id]);

  const close = () => setOpen(false);

  const show = () => {
    setOpen(true);
    setRefusal(null);
    setState(null);
    void load();
  };

  const act = async (action: "issue" | "revoke") => {
    setBusy(true);
    setRefusal(null);
    try {
      if (action === "issue") {
        const person = state?.personRequired ? { firstName: firstName.trim(), lastName: lastName.trim() } : {};
        const issued = await userService.issueInvitation(user.id, person);
        addToast({
          type: issued.emailQueued ? "success" : "warning",
          title: t(issued.emailQueued ? "users.invitation.sent" : "users.invitation.notQueued", { name: nameOf(user) }),
          description: t("users.invitation.expires", { date: date(issued.expiresAt) }),
        });
      } else {
        await userService.revokeInvitation(user.id);
        addToast({ type: "success", title: t("users.invitation.withdrawn", { name: nameOf(user) }) });
      }
      onChanged?.();
      await load();
    } catch (err) {
      setRefusal(describeApiError(err).message || t("users.invitation.failed"));
    } finally {
      setBusy(false);
    }
  };

  const namesMissing = state?.personRequired === true && (!firstName.trim() || !lastName.trim());

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        title={t("users.invitation.open", { name: nameOf(user) })}
        aria-label={t("users.invitation.open", { name: nameOf(user) })}
        onClick={show}
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Dialog isOpen={open} onClose={close} title={t("users.invitation.title", { name: nameOf(user) })} size="md">
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">{t("users.invitation.lead")}</p>

          {loadFailed && (
            <Alert variant="error">
              <div className="flex items-center justify-between gap-3">
                <span>{t("users.invitation.loadFailed")}</span>
                <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void load()}>
                  {t("users.invitation.retry")}
                </Button>
              </div>
            </Alert>
          )}
          {!state && !loadFailed && <p className="text-sm text-muted-foreground">{t("users.invitation.loading")}</p>}

          {state && !state.invitationsOpen && <Alert variant="info">{t("users.invitation.gateClosed")}</Alert>}

          {state?.live && (
            <p className="text-sm text-foreground" data-testid="invitation-live">
              {t(state.live.expired ? "users.invitation.liveExpired" : "users.invitation.live", {
                issued: date(state.live.issuedAt),
                expires: date(state.live.expiresAt),
                by: state.live.issuedBy?.name ?? "—",
              })}
            </p>
          )}
          {state && !state.live && state.firstIssuedAt && (
            <p className="text-sm text-muted-foreground">{t("users.invitation.firstIssued", { date: date(state.firstIssuedAt) })}</p>
          )}

          {state?.invitationsOpen && state.personRequired && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-foreground">{t("users.invitation.person.legend")}</legend>
              <p className="text-sm text-muted-foreground">{t("users.invitation.person.help")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={ids.first} className="block text-sm font-medium text-foreground">
                    {t("users.invitation.person.firstName")}
                  </label>
                  <input id={ids.first} className={FIELD} maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label htmlFor={ids.last} className="block text-sm font-medium text-foreground">
                    {t("users.invitation.person.lastName")}
                  </label>
                  <input id={ids.last} className={FIELD} maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
            </fieldset>
          )}

          {refusal && (
            <Alert variant="error">{refusal}</Alert>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {state?.live && (
              <Button variant="outline" isLoading={busy} onClick={() => void act("revoke")}>
                {t("users.invitation.withdraw")}
              </Button>
            )}
            {state?.invitationsOpen && (
              <Button variant="primary" isLoading={busy} disabled={namesMissing} onClick={() => void act("issue")}>
                {t(state.live ? "users.invitation.sendAgain" : "users.invitation.send")}
              </Button>
            )}
            <Button variant="ghost" onClick={close}>
              {t("users.invitation.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

export default InvitationActions;
