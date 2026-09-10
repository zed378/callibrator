// src/app/dashboard/tenants/components/sso/SsoXmlTab.tsx
import React from "react";
import { Button } from "@/components/ui";
import { Upload, X, FileCode } from "lucide-react";

interface SsoXmlTabProps {
  xmlContent: string;
  setXmlContent: (val: string) => void;
  xmlError: string | null;
  handleXmlFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleXmlParse: () => void;
}

export const SsoXmlTab: React.FC<SsoXmlTabProps> = ({
  xmlContent,
  setXmlContent,
  xmlError,
  handleXmlFileUpload,
  handleXmlParse,
}) => {
  return (
    <div className="space-y-5">
      <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl text-xs text-muted-foreground space-y-1">
        <span className="font-semibold text-white block mb-1">Auto-Configuration with Metadata XML</span>
        Upload or paste the SAML Metadata XML provided by your Identity Provider to automatically populate the IdP Issuer, Single Sign-On URL, and Public Certificate.
      </div>

      {xmlError && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-xs flex items-center gap-3 animate-fade-in">
          <X className="w-5 h-5 flex-shrink-0" />
          {xmlError}
        </div>
      )}

      {/* XML File Upload */}
      <div className="border-dashed border border-border hover:border-primary/50 bg-muted/50 hover:bg-primary/[0.02] rounded-2xl p-6 transition-all flex flex-col items-center justify-center text-center cursor-pointer relative group ring-1 ring-border">
        <input
          type="file"
          accept=".xml"
          onChange={handleXmlFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <Upload className="w-8 h-8 text-muted-foreground group-hover:text-primary mb-2 transition-all" />
        <span className="text-sm font-semibold text-white group-hover:text-primary">Upload IdP Metadata XML File</span>
        <span className="text-xs text-muted-foreground mt-1">Accepts XML formats</span>
      </div>

      {/* XML Text Paste */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground block">Or Paste Metadata XML content directly</label>
        <textarea
          value={xmlContent}
          onChange={(e) => setXmlContent(e.target.value)}
          rows={6}
          placeholder="<?xml version='1.0'?>\n<EntityDescriptor ..."
          className="w-full bg-muted/50 rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all text-xs font-mono ring-1 ring-border"
        />
      </div>

      {/* Import button */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button
          variant="primary"
          onClick={handleXmlParse}
          disabled={!xmlContent.trim()}
          leftIcon={<FileCode className="w-4 h-4" />}
        >
          Import Configuration Parameters
        </Button>
      </div>
    </div>
  );
};

export default SsoXmlTab;
