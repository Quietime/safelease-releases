# 1.5.1

Fix getting-started.js missing from MainActivity.resource() asset allowlist. The APK contained the script but the native loader returned 404, hiding both new entries. Preserve databases, records, signing identity and update channel.

Regression: browser integration harness now extracts the actual Java resource allowlist. The original code fails with 404; the fixed code passes 18 checks. Failure and passing reports are retained in qa/v151. Android release build and lint pass; no connected Android device, so this is not a physical-device acceptance claim.
