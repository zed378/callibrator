import React from "react";
import { Dialog, Button } from "@/components/ui";
import { CheckCircle2 } from "lucide-react";
import { Certificate } from "@/api/services/calibration.service";
import { ESignatureFields, ESignatureFormFields } from "./ESignatureFields";

/**
 * Approving is a signed act under 21 CFR Part 11, so it collects credentials
 * rather than firing straight from the table row.
 */
interface ApproveCertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  selectedCertToApprove: Certificate | null;
  form: ESignatureFormFields;
  setForm: React.Dispatch<React.SetStateAction<ESignatureFormFields>>;
  isLoading: boolean;
}

export const ApproveCertModal: React.FC<ApproveCertModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  selectedCertToApprove,
  form,
  setForm,
  isLoading,
}) => {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Approve Certificate">
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="flex gap-3 text-foreground">
          <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
          <div>
            <p className="font-semibold">
              Approve Certificate {selectedCertToApprove?.certificateNumber}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Approval is recorded against your user ID with the meaning you
              state below. It can only be undone by revoking the certificate.
            </p>
          </div>
        </div>

        <ESignatureFields
          form={form}
          setForm={setForm}
          meaningOptions={[
            "Reviewed and approved",
            "Approved for release",
            "Quality reviewed",
          ]}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            Approve Certificate
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default ApproveCertModal;
