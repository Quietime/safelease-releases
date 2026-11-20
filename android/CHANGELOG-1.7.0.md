# SafeLease SG 1.7.0 (versionCode 17000)

## Order of steps
- Each lease page opens with a progress card. It shows five steps (move-in recorded, landlord joined, both confirmed move-in, move-out recorded, deposit returned) and one next step worked out from the records. **Go to this step** scrolls to the right form and opens it.
- Tenant next steps follow the lease. Record move-in first, then invite the landlord, then confirm your own version. A disputed, refused or expired move-in leads to a supplement. In the last 30 days of the lease, or after it, move-out comes first.
- A landlord is pointed to the version waiting for their decision, or told nothing is waiting.
- Lease members, with the landlord invitation, now sit right after the move-in record instead of after move-out.
- On the lease list, **Create a lease** is folded away once you have a lease. A new user sees **New to SafeLease?** before the form.

## Interface
- On phones the main sections are a bottom bar, one tap away instead of opening a menu first.
- Header actions are compact pills in one scrollable row.
- Lease rows, panels, details and buttons are calmer, with lighter borders and soft shadows. The red and white palette from 1.2.3 is kept.
- The disabled **Gallery unavailable** button is replaced by a sentence that explains why only the in-app camera is used.
- The lease ID is still shown, but smaller, under the dates.

## Unchanged
Java code, permissions, database migrations, records, photos, hashes, decisions, exports, updater and the signing certificate. Install over 1.6.2 or earlier to keep all data.

## Checks
- `android/qa/test-android.mjs`, 7 steps in Chromium with the real assets and SQLite. Covers bottom navigation, guide placement, a new lease at 0/5, **Go to this step**, the folded create form, the next step for all seven demo scenarios, the landlord view, Chinese and English copy, WCAG AA text contrast (the v1.4 audit) and no overflow at 360, 393 and 768 px.
- The project's own v1.5.1 onboarding suite, 18 of 18 pass on these assets.
- `build_apk.py build` output differs from 1.6.2 only in five assets and `AndroidManifest.xml`. `classes.dex` and `resources.arsc` are identical, compression is preserved, `zipalign -c -p 4` passes and `aapt` reads 1.7.0 (17000).
- A test signature with a throwaway key verifies with `apksigner`. `sign` and `promote` both refuse it, as they should.
- Not checked here: a physical device, the real camera, Activity recreation and the system installer.

## Release build (no demo mode)

- The practice workspace and its "Demo mode" entry points (header button, guide and home-page buttons) are removed. `showcase()` now returns to the personal workspace or opens the guide.
- Demo accounts and scenarios are no longer written into the personal database on first start (`android-api.js` seeds only in the practice workspace, which the app now leaves on start).
- On phones updated from 1.6.2, any `@demo.invalid` accounts in the personal database are disabled, so nobody can sign in with them; a phone left in the practice workspace returns to its own records.
- "Load sample deductions" is removed from the Deduction Check.
- `android/qa/test-android.mjs` checks all of the above instead of walking the demo scenarios (8/8 pass; the same checks fail on the unmodified 1.7.0 assets).
