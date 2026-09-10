import React from "react";
import { Dialog, Input, Textarea, Button } from "@/components/ui";
import { Shield } from "lucide-react";
import { Certificate } from "@/api/services/calibration.service";
import { ESignatureFields, ESignatureFormFields } from "./ESignatureFields";

interface SignFormState extends ESignatureFormFields {
  digitalSignature: string;
  digitalSignatureKeyId: string;
}

interface SignCertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  selectedCertToSign: Certificate | null;
  form: SignFormState;
  setForm: React.Dispatch<React.SetStateAction<SignFormState>>;
  isLoading: boolean;
}

export const SignCertModal: React.FC<SignCertModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  selectedCertToSign,
  form,
  setForm,
  isLoading,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Apply Digital Cryptographic Signature"
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="flex gap-3 text-foreground">
          <Shield className="h-6 w-6 text-primary shrink-0" />
          <div>
            <p className="font-semibold">
              Sign Certificate {selectedCertToSign?.certificateNumber}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Applying this digital signature binds the cryptographic
              verification token to your user ID. Once signed, the certificate
              status updates to Signed &amp; Locked, preventing edits.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Secure Key Container / Key ID
          </label>
          <Input required disabled value={form.digitalSignatureKeyId} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Generated Cryptographic Token
          </label>
          <Textarea
            required
            disabled
            rows={3}
            className="font-mono text-xs"
            value={form.digitalSignature}
          />
        </div>

        <ESignatureFields
          form={form}
          setForm={setForm}
          meaningOptions={[
            "Reviewed and signed",
            "Authored",
            "Verified",
            "Responsible for the calibration result",
          ]}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-success hover:bg-success"
          >
            Apply Signature
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default SignCertModal;
