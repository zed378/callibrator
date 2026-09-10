# 06 — Browser Testing

Playwright. `automate/`, 71 tests.

```bash
npx playwright test
make test-browser
```

---

## Coverage

Auth, navigation, tenants, roles, users, kanban, notifications, account, profile, module health, and dark/light mode.

This is the layer that proves a **flow** works, not that a function does. It is also the only layer that exercises the browser's own behaviour — focus, keyboard, storage, autoplay policy.

## Flakes Have Been Self-Inflicted

Long runs have failed with `ECONNRESET`. The cause was **editing a backend file mid-run**, which triggers nodemon, which restarts the server underneath the test.

Clean re-runs pass.

**Do not chase a flake until you have confirmed nothing was recompiling.** Time spent debugging a race that was actually a restart is time entirely wasted, and this has already happened.

## Expected Failures, Kept Deliberately

Two markers are retained rather than deleted to make the suite look green:

| Marker | Status |
|---|---|
| User-edit modal, fuller-payload persistence | **the backend was verified to persist correctly**; the marker is a UI-side issue and stands |
| A role display-name assertion | |

**A suite made green by deleting the failing test tells you nothing.**

The tenant-create marker was the reverse case: a `test.fail()` whose own comment predicted it would flip once the backend was fixed — and when the `subdomain` derivation defect was fixed (ADR-036), it did. That is a marker doing its job.

## What Belongs Here Rather Than Lower

| Flow | Why it needs a browser |
|---|---|
| Sign in, including MFA and WebAuthn | browser credential APIs |
| **Sidebar renders exactly the granted menu groups** | server-resolved tree, rendered |
| Reaching a route without permission → `AccessDeniedModal` | routing plus state |
| **Realtime notification arrives without a refresh** | a live Socket.IO connection |
| Theme toggle persists, no flash on reload | `ThemeInitScript` runs before paint |
| **The public verification page on a real viewport** | no session, unknown device |
| Tenant creation end to end | the flow that was broken |

## Authorization Is Absence, Not Invisibility

```ts
await expect(page.getByText("Billing")).toHaveCount(0);        // ✓
await expect(page.getByText("Billing")).not.toBeVisible();     // ✗
```

An unauthorised surface is **absent from the DOM**, not hidden. A hidden element is still there, and its route is still reachable by typing the URL.

`toBeVisible()` passing is not the same as the element not existing, and that distinction is the entire design ([`../FRONTEND/05-RBAC-IN-UI.md`](../FRONTEND/05-RBAC-IN-UI.md)).

## The Three List States

The highest-value browser assertion in the product:

```ts
test("a failed list request shows an error, not an empty list", async ({ page }) => {
  await page.route("**/api/v1/calibration-devices*", (r) => r.fulfill({ status: 500 }));
  await page.goto("/dashboard/devices");
  await expect(page.getByText(/could not load/i)).toBeVisible();
  await expect(page.getByText(/no devices yet/i)).toHaveCount(0);   // ← the point
});
```

Rendering an empty list when the request failed is a lie about a compliance figure. The QMS and SOP screens did exactly this for weeks, with no error anywhere.

Assert **which component** rendered, not merely the absence of rows.

## The Verification Page

The screen nobody who works on the product uses, which makes it the first forgotten in a redesign and the last tested.

```ts
test("verification works with no session", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined });   // no auth
  const page = await ctx.newPage();
  await page.goto(`/verify/${certificateNumber}`);
  await expect(page.getByRole("heading", { name: /valid/i })).toBeVisible();
});

test("unknown and tampered look identical", async ({ page }) => {
  // otherwise it is a certificate-number oracle
});
```

Also: at 375px, at 200% zoom, and readable in greyscale.

## Realtime

```ts
test("a notification arrives without a refresh", async ({ page }) => {
  await page.goto("/dashboard");
  await triggerServerSideEvent();
  await expect(page.getByTestId("notification-count")).toHaveText("1");
});
```

This is also the only place that would catch a **reverse proxy missing the WebSocket upgrade headers** — without them Socket.IO silently falls back to long-polling, which works well enough that nothing else notices.

Browser autoplay suppression on the notification sound is **not an error** and must not fail a test.

## Accessibility

`axe` in the browser suite, plus assertions automation cannot make:

| Assertion |
|---|
| the calibration form is completable **keyboard-only** |
| focus is trapped in a modal and restored on close |
| Escape closes a modal |
| the Kanban board is operable without a mouse |
| every status badge carries **text**, not colour alone |

The first is a release gate (UX-35). Automated tools catch roughly a third of WCAG failures.

## Fixtures and Data

Use the **demo seeder**. An empty database hides an entire class of defect — defect #15 was only visible once there was data.

**Never suspend the default tenant.** It suspends the super-admin who lives in it and 403s everything afterwards; recovery required a direct database update. Create a disposable tenant, exactly as the E2E suite now does.

## Stability

| Rule | |
|---|---|
| Query by **role and accessible name** | a suite full of `data-testid` would pass on an unusable UI |
| Playwright auto-waiting, not fixed sleeps | |
| Each test creates its own data | shared state passes in one order and fails in another |
| `--workers=1` against a shared database | |
| Traces and screenshots on failure | |

## What the Browser Suite Cannot Tell You

| Question | Answered by |
|---|---|
| Is the tenant predicate applied on every endpoint? | live E2E, two tenants |
| Does a rollback leave no audit row? | integration |
| Does a control actually exist? | **mutation check** |
| Does it hold under load? | performance testing |

A green browser suite means the happy paths work in a browser. It does not mean the system is correct.
