# P27-03 — Session-only sticker sheet printing

2026-11-25. Owner-delegated implementation continuation.
Refs: ADR-138 amendments 3–5; P19-07 §10; existing P27-03 layout record.

Retain individual issue/replace/revoke and 60 × 40 mm labels. Add an explicit
"Add to sheet" action only for the label returned by the existing issue/replace
call. Keep its QR image and label text in the mounted register's React state,
keyed by the authenticated user and tenant. Never persist tokens or recover
existing links; no batch mint endpoint. Replacing, revoking or deleting a device
removes its old tray entry. Adding the same device replaces its entry.

Print conventional A4 portrait sheets: 3 columns × 6 rows (18 labels), 5 mm gaps,
10 mm side margins, 16 mm top/bottom margins. Reuse each 60 × 40 mm label without
scaling. More labels create more sheets. Browser print uses 100% actual size;
no printer calibration or phone scan is inferred. Existing thermal-label print
and PNG remain available. Tray supports remove/clear and warns that navigation
or sign-out loses it; printed output contains no capability URL as text.

Tests must cover pagination, duplicate replacement, removal/invalidation,
no token persistence, print portal lifecycle/geometry, and unchanged issuance.
Verify focused tests, lint, TypeScript and an actual Chromium print/PDF render
where available. Physical label-printer verification remains excluded.
