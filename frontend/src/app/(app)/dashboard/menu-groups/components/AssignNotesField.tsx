"use client";

interface AssignNotesFieldProps {
  value: string;
  onChange: (val: string) => void;
  disabled: boolean;
}

export function AssignNotesField({
  value,
  onChange,
  disabled,
}: AssignNotesFieldProps) {
  return (
    <div>
      <label
        htmlFor="assign-notes"
        className="block text-sm font-medium mb-2 text-muted-foreground"
      >
        Assignment Notes (Optional)
      </label>
      <textarea
        id="assign-notes"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Add a note about this assignment..."
        className="w-full px-4 py-3 rounded-xl resize-y outline-none transition-all disabled:opacity-50 ring-1 ring-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-ring/50"
      />
    </div>
  );
}
