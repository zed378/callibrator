import React from "react";
import { Dialog, Textarea, Button } from "@/components/ui";
import { AlertTriangle } from "lucide-react";
import { Certificate } from "@/api/services/calibration.service";
import { ESignatureFields, ESignatureFormFields } from "./ESignatureFields";

interface RevokeFormState extends ESignatureFormFields {
  reason: string;
}

interface RevokeCertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  selectedCertToRevoke: Certificate | null;
  form: RevokeFormState;
  setForm: React.Dispatch<React.SetStateAction<RevokeFormState>>;
  isLoading: boolean;
}

export const RevokeCertModal: React.FC<RevokeCertModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  selectedCertToRevoke,
  form,
  setForm,
  isLoading,
}) => {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Revoke Certificate">
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="flex gap-3 text-destructive">
          <AlertTriangle className="h-6 w-6 shrink-0" />
          <div>
            <p className="font-semibold">
              Revoke Certificate {selectedCertToRevoke?.certificateNumber}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This action is permanent. Revoking a certificate signals that the
              equipment calibration status is no longer compliant.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Reason for Revocation *
          </label>
          <Textarea
            required
            value={form.reason}
            // Spread the existing form — replacing it wholesale wiped the
            // e-signature fields below.
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="e.g. Device dropped/defect detected, calibration schedule missed..."
            rows={3}
          />
        </div>

        <ESignatureFields
          form={form}
          setForm={setForm}
          meaningOptions={[
            "Revoked",
            "Revoked in error correction",
            "Superseded by a newer certificate",
            "Equipment no longer compliant",
          ]}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={isLoading}>
            Revoke Certificate
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default RevokeCertModal;
