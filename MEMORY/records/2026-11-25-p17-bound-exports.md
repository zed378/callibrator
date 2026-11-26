# 2026-11-25 — P17 PT-04 bound browser export matrix

Status: implemented and verified in the working tree; no P17 exit claimed.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` § 12 PT-04,
P19-04 facility scope, P21-06 export reads (ADR-133 Amendment 3).

`automate/p22.browser.mts` now creates a facility-bound HEALTHCARE ADMIN reader
for the browser suite's real F1 device. A second facility holds a distinct device
and calibration canary. The browser executes inventory XLSX/PDF and both dated
and latest-only calibration recap XLSX controls. It captures actual API response
bodies, requires the F1 device as a positive control, rejects rows with another
`clientFacilityId`, rejects the F2 canary's identifiers, and inspects downloaded
XLSX worksheet content. The inventory PDF was checked for a valid PDF signature;
its downloaded contents were not parsed. No mocks or production data are involved.

TypeScript 7 automate project check passed. Initial browser startup inside the
sandbox timed out; the approved unrestricted local run launched successfully.
The first extended run exposed test harness state/selector errors (105/109).
Explicit format/layout waits and the recap label selector corrected those
errors. The full `automate/p22.browser.mts` rerun passed **109/109** in 214,072
ms, including all four PT-04 cases above. No security finding was observed.

Limitations: this matrix does not claim photo-bearing PDF signed-link coverage,
multi-page large exports, or an IPM-list export. The current IPM history page has
no list export control (`frontend/src/app/(app)/dashboard/ipm/IpmClient.tsx`);
the existing suite separately checks its report PDF as an unbound reader.
Physical-device UAT remains excluded by owner. No owner signoff or P17 completion.
