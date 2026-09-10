import React from "react";
import { Activity, ShieldCheck } from "lucide-react";

/**
 * The two floating annotation chips that overlay the hero visual. Shared by the
 * static poster (rendered over the MediaFrame) and the 3D canvas overlay so the
 * two states look identical. Positioned against the nearest relative ancestor.
 */
export default function HeroChips() {
  return (
    <>
      <div className="absolute -left-4 bottom-8 flex animate-float items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-xl backdrop-blur-sm sm:-left-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
          <Activity className="h-5 w-5" />
        </span>
        <div>
          <div className="text-lg font-bold leading-none text-foreground">99.2%</div>
          <div className="mt-1 text-xs text-muted-foreground">on schedule</div>
        </div>
      </div>
      <div className="absolute -right-3 top-6 flex animate-float-reverse items-center gap-2 rounded-full border border-border bg-card/95 px-3.5 py-2 shadow-lg backdrop-blur-sm">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">Audit-ready</span>
      </div>
    </>
  );
}
