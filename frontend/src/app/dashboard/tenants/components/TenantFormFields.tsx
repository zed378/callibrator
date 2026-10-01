import React from "react";
import { Input, Textarea } from "@/components/ui";
import { Building2, Shield } from "lucide-react";
import { accessibleBrandPalette, type ThemedBrand } from "@/lib/brandColor";

/**
 * ADR-090 amendment: what the brand colour will actually render as. A colour
 * too light for the light theme (or too dark for the dark one) is shown with
 * the shade that replaces it, so the administrator is never surprised.
 */
export const BrandColorPreview: React.FC<{ value: string }> = ({ value }) => {
  const palette = accessibleBrandPalette(value);
  if (!palette) return null;
  const swatch = (theme: string, t: ThemedBrand) => (
    <li key={theme} className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-flex h-6 min-w-12 items-center justify-center rounded px-1.5 text-xs font-semibold"
        style={{ backgroundColor: t.primary, color: t.foreground }}
      >
        Aa
      </span>
      <span className="text-xs text-muted-foreground">
        {theme} theme: <span className="font-mono">{t.primary}</span>
        {t.adjusted ? " (adjusted for contrast)" : " (as chosen)"}
      </span>
    </li>
  );
  return (
    <ul aria-label="Brand color as rendered" className="mt-2 space-y-1" data-testid="brand-color-preview">
      {swatch("Light", palette.light)}
      {swatch("Dark", palette.dark)}
    </ul>
  );
};

interface TenantFormFieldsProps {
  form: {
    name: string;
    code: string;
    description: string;
    primaryColor: string;
    limitSeats: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    website: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      name: string;
      code: string;
      description: string;
      primaryColor: string;
      limitSeats: string;
      email: string;
      phone: string;
      address: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      website: string;
    }>
  >;
  showBasicOnly?: boolean;
}

export const TenantFormFields: React.FC<TenantFormFieldsProps> = ({
  form,
  setForm,
  showBasicOnly = false,
}) => {
  const update = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Hospital Name"
          leftIcon={<Building2 className="h-4 w-4" />}
          required
        />
        <Input
          label="Code"
          value={form.code}
          onChange={(e) => update("code", e.target.value)}
          placeholder="HOSP001"
          required
        />
      </div>
      <Textarea
        label="Description"
        value={form.description}
        onChange={(e) => update("description", e.target.value)}
        placeholder="Organization description"
        rows={3}
      />
      <div>
        <label
          htmlFor="tenant-brand-color"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Brand Color
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label="Brand color picker"
            value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : "#4f46e5"}
            onChange={(e) => update("primaryColor", e.target.value)}
            className="h-10 w-14 shrink-0 rounded-lg border border-border bg-card cursor-pointer"
          />
          <div className="flex-1">
            <Input
              id="tenant-brand-color"
              value={form.primaryColor}
              onChange={(e) => update("primaryColor", e.target.value)}
              placeholder="#4f46e5"
              aria-describedby="tenant-brand-color-help"
            />
          </div>
        </div>
        <p id="tenant-brand-color-help" className="mt-1 text-xs text-muted-foreground">
          Drives the primary theme color for users of this tenant. Each theme
          uses the closest shade of it that stays readable (WCAG AA).
        </p>
        <BrandColorPreview value={form.primaryColor} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Seat limit"
          type="number"
          min={1}
          value={form.limitSeats}
          onChange={(e) => update("limitSeats", e.target.value)}
          placeholder="Plan default"
          leftIcon={<Shield className="h-4 w-4" />}
        />
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="tenant@example.com"
        />
      </div>
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
      {!showBasicOnly && (
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
      )}
      {!showBasicOnly && (
        <Input
          label="Website"
          type="url"
          value={form.website}
          onChange={(e) => update("website", e.target.value)}
          placeholder="https://example.com"
        />
      )}
    </>
  );
};
