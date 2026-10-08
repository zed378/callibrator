"use client";

/**
 * ADR-122 (P11-02, P11-Q4 A): the way back to "follow the device". The top
 * bar's toggle makes a choice; this forgets it, on both surfaces. It lives on
 * the profile page because the dashboard has no user menu yet (spec P11-00 §6
 * item 2; the menu is P11-10).
 */
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui";

export default function AppearanceSettings() {
  const { theme, choice, followDevice } = useTheme();
  const shown = theme === "dark" ? "Dark" : "Light";

  return (
    <section aria-labelledby="appearance-heading" className="p-6 bg-muted/50 rounded-2xl shadow-sm border border-border">
      <h2 id="appearance-heading" className="text-base font-semibold text-foreground mb-2">
        Appearance
      </h2>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {choice
          ? `${shown} mode, as you chose. It applies on the sign-in and public pages too.`
          : `${shown} mode, following this device's setting.`}
      </p>
      <div className="mt-4">
        <Button variant="outline" size="sm" onClick={followDevice} disabled={!choice}>
          Use device setting
        </Button>
      </div>
    </section>
  );
}
