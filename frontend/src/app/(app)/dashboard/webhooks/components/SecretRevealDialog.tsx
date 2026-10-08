// src/app/dashboard/webhooks/components/SecretRevealDialog.tsx
import React from "react";
import { Dialog, Button, Alert } from "@/components/ui";
import { Copy } from "lucide-react";
import type {
  RevealedSecret,
  SecretRevealReason,
} from "../hooks/useWebhooks";

interface SecretRevealDialogProps {
  revealed: RevealedSecret | null;
  onCopy: () => void;
  onClose: () => void;
}

const TITLES: Record<SecretRevealReason, string> = {
  created: "Webhook Created",
  rotated: "Signing Secret Rotated",
  url_changed: "New Signing Secret Issued",
};

const LEADS: Record<SecretRevealReason, string> = {
  created: "Configure this signing secret on your endpoint.",
  rotated:
    "The previous secret stopped working immediately. Update your endpoint with this one before the next delivery.",
  url_changed:
    "Changing the URL issued a new signing secret, and the previous one stopped working. Configure this one on the new endpoint.",
};

/**
 * Shows a webhook signing secret the backend returned once (A-51) — after
 * create, rotate, or a url change. The backend never returns it again, so the
 * only copy the user will ever see is this one.
 */
export const SecretRevealDialog: React.FC<SecretRevealDialogProps> = ({
  revealed,
  onCopy,
  onClose,
}) => {
  if (!revealed) return null;

  return (
    <Dialog isOpen onClose={onClose} title={TITLES[revealed.reason]}>
      <div className="space-y-4 pt-2">
        <Alert
          variant="warning"
          title="You will not see this secret again"
        >
          It is shown only once and cannot be retrieved later. Copy it and
          store it securely before closing this dialog. If it is lost, rotate
          the secret to issue a new one.
        </Alert>

        <p className="text-sm text-muted-foreground">
          {LEADS[revealed.reason]}
        </p>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Endpoint
          </p>
          <code className="font-mono text-xs text-foreground block break-all">
            {revealed.webhookUrl}
          </code>
        </div>

        <div>
          <p
            id="webhook-signing-secret-label"
            className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1"
          >
            Signing Secret
          </p>
          <div className="flex items-center gap-2">
            <code
              aria-labelledby="webhook-signing-secret-label"
              data-testid="webhook-signing-secret"
              className="flex-1 block font-mono text-sm bg-muted text-foreground rounded-lg px-3 py-2.5 break-all select-all border border-border"
            >
              {revealed.secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopy}
              aria-label="Copy signing secret"
              className="shrink-0 flex items-center gap-1.5"
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Each delivery includes an{" "}
            <code className="font-mono">X-Webhook-Timestamp</code> header and
            an <code className="font-mono">X-Webhook-Signature</code> header
            (<code className="font-mono">v1=</code> an HMAC-SHA256, computed
            with this secret, of the timestamp, a dot, and the raw request
            body). Verify the signature, reject timestamps older than five
            minutes, and deduplicate on{" "}
            <code className="font-mono">X-Webhook-Delivery</code>.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="button" onClick={onClose}>
            I have stored the secret
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default SecretRevealDialog;
