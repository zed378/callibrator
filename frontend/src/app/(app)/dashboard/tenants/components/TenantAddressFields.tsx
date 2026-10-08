// src/app/dashboard/tenants/components/TenantAddressFields.tsx
import React from "react";
import { Input, Textarea } from "@/components/ui";

interface FormState {
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  website: string;
}

interface TenantAddressFieldsProps {
  form: FormState;
  update: (field: keyof FormState, value: string) => void;
}

export const TenantAddressFields: React.FC<TenantAddressFieldsProps> = ({
  form,
  update,
}) => {
  return (
    <>
      <Input
        label="Phone"
        type="tel"
        value={form.phone}
        onChange={(e) => update("phone", e.target.value)}
        placeholder="+62 xxx xxxx xxxx"
      />
      <Textarea
        label="Address"
        value={form.address}
        onChange={(e) => update("address", e.target.value)}
        placeholder="Street address"
        rows={2}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Input
          label="City"
          value={form.city}
          onChange={(e) => update("city", e.target.value)}
          placeholder="City"
        />
        <Input
          label="State"
          value={form.state}
          onChange={(e) => update("state", e.target.value)}
          placeholder="State"
        />
        <Input
          label="Zip Code"
          value={form.zipCode}
          onChange={(e) => update("zipCode", e.target.value)}
          placeholder="12345"
        />
        <Input
          label="Country"
          value={form.country}
          onChange={(e) => update("country", e.target.value)}
          placeholder="Indonesia"
        />
      </div>
      <Input
        label="Website"
        type="url"
        value={form.website}
        onChange={(e) => update("website", e.target.value)}
        placeholder="https://example.com"
      />
    </>
  );
};

export default TenantAddressFields;
