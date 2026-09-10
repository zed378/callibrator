// src/app/dashboard/tenants/components/LogoPreview.tsx
"use client";

import React from "react";
import { Button, Input } from "@/components/ui";
import { X, Building2 } from "lucide-react";
import Image from "next/image";

interface LogoPreviewProps {
  preview: string;
  onClear: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isEdit?: boolean;
  keepOld?: boolean;
  existingLogo?: string;
}

export const LogoPreview: React.FC<LogoPreviewProps> = ({
  preview,
  onClear,
  onFileChange,
  isEdit = false,
  keepOld = false,
  existingLogo,
}) => {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        Logo
      </label>
      <div className="flex items-center gap-4">
        {preview ? (
          <div className="relative">
            <Image
              src={preview}
              alt="Logo preview"
              width={80}
              height={80}
              className="w-20 h-20 object-cover rounded-lg shadow-sm"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
              onClick={onClear}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex items-center justify-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <Input
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="flex-1"
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {isEdit
          ? keepOld && !existingLogo
            ? "New logo will replace the current one"
            : keepOld
              ? "Current logo will be kept"
              : preview
                ? "New logo will replace the current one"
                : "Upload a logo (PNG, JPG, SVG)"
          : "Upload a logo for this tenant (PNG, JPG, SVG)"}
      </p>
    </div>
  );
};

export default LogoPreview;
