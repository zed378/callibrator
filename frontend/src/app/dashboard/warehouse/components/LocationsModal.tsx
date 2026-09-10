// src/app/dashboard/warehouse/components/LocationsModal.tsx
import React from "react";
import {
  Dialog,
  FormField,
  Input,
  Textarea,
  Button,
  Badge,
} from "@/components/ui";
import { Edit, Trash2, MapPin } from "lucide-react";
import type { Warehouse, StorageLocation } from "@/types";

export interface LocationFormState {
  name: string;
  code: string;
  description: string;
  isActive: boolean;
}

interface LocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedWarehouse: Warehouse | null;
  locations: StorageLocation[];
  hasWriteAccess: boolean;
  locationFormType: "create" | "edit";
  locationForm: LocationFormState;
  setLocationForm: React.Dispatch<React.SetStateAction<LocationFormState>>;
  onSubmitLocation: (e: React.FormEvent) => void;
  onEditLocationSelect: (loc: StorageLocation) => void;
  onDeleteLocationConfirm: (id: string) => void;
  onCancelEditLocation: () => void;
}

export const LocationsModal: React.FC<LocationsModalProps> = ({
  isOpen,
  onClose,
  selectedWarehouse,
  locations,
  hasWriteAccess,
  locationFormType,
  locationForm,
  setLocationForm,
  onSubmitLocation,
  onEditLocationSelect,
  onDeleteLocationConfirm,
  onCancelEditLocation,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Sub-locations: ${selectedWarehouse?.name || ""}`}
      size="xl"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side: Create / Edit Form */}
        {hasWriteAccess && (
          <div className="lg:col-span-1 border-r border-border pr-6 space-y-4">
            <h3 className="font-bold text-foreground">
              {locationFormType === "create" ? "Add Sub-location" : "Edit Sub-location"}
            </h3>
            <form onSubmit={onSubmitLocation} className="space-y-4">
              <FormField label="Location Name" required>
                <Input
                  type="text"
                  placeholder="e.g. Shelf A-03"
                  value={locationForm.name}
                  onChange={(e) =>
                    setLocationForm({ ...locationForm, name: e.target.value })
                  }
                  required
                />
              </FormField>
              <FormField label="Location Code" required>
                <Input
                  type="text"
                  placeholder="e.g. SH-A03"
                  value={locationForm.code}
                  onChange={(e) =>
                    setLocationForm({ ...locationForm, code: e.target.value })
                  }
                  required
                />
              </FormField>
              <FormField label="Description">
                <Textarea
                  placeholder="e.g. Temperature-controlled shelf"
                  value={locationForm.description}
                  onChange={(e) =>
                    setLocationForm({ ...locationForm, description: e.target.value })
                  }
                />
              </FormField>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="loc-active"
                  checked={locationForm.isActive}
                  onChange={(e) =>
                    setLocationForm({ ...locationForm, isActive: e.target.checked })
                  }
                  className="rounded border-border text-primary focus:ring-ring"
                />
                <label htmlFor="loc-active" className="text-sm font-semibold text-foreground">
                  Is Location Active
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                {locationFormType === "edit" && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onCancelEditLocation}
                  >
                    Cancel
                  </Button>
                )}
                <Button type="submit" variant="primary" className="flex-1">
                  {locationFormType === "create" ? "Add Location" : "Save Location"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Right Side: List Locations */}
        <div className={hasWriteAccess ? "lg:col-span-2 space-y-4" : "lg:col-span-3 space-y-4"}>
          <h3 className="font-bold text-foreground">
            Configured Storage Shelves / Rooms
          </h3>
          {locations.length > 0 ? (
            <div className="max-h-[50vh] overflow-y-auto border border-border rounded-xl divide-y divide-border bg-card">
              {locations.map((loc) => (
                <div
                  key={loc.id}
                  className="p-4 flex items-center justify-between hover:bg-muted transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{loc.name}</span>
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {loc.code}
                      </span>
                    </div>
{loc.description && (
                       <div className="text-xs text-muted-foreground mt-0.5">
                         {loc.description}
                       </div>
                     )}
                    <div className="mt-1">
                      <Badge variant={loc.isActive ? "success" : "default"}>
                        {loc.isActive ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </div>
                  </div>
                  {hasWriteAccess && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEditLocationSelect(loc)}
                        className="p-1"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteLocationConfirm(loc.id)}
                        className="p-1 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center p-12 border border-dashed border-border rounded-xl text-muted-foreground">
              <MapPin className="mx-auto h-10 w-10 opacity-40 mb-2" />
              <p className="text-sm font-medium">No storage shelves defined under this warehouse.</p>
              <p className="text-xs mt-1">Specify shelf names to enable detailed unit tracking.</p>
            </div>
          )}
          <div className="flex justify-end pt-4 border-t border-border">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default LocationsModal;
