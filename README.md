# SafeLease SG releases

This repository is the public release channel for SafeLease SG. GitHub Pages serves it at https://quietime.github.io/safelease-releases/

| Path | What it is |
| --- | --- |
| `index.html` | Download page for both apps |
| `web/` | Web app (PWA), version in `web/core.js` as `WEB_VERSION` |
| `app/` | Signed Android APK, `update.json` manifest and `SHA256SUMS.txt` |
| `tools/verify_release.py` | Checks that every release file agrees with `app/update.json` |
| `.github/workflows/release.yml` | Publishes the GitHub Release on every push to `main` |
| `tests/` | Unit tests for the web app logic and an end-to-end browser walk |

## How the Android update works

The installed app reads `releases/latest/download/update.json`. A version only reaches phones after it is published as the latest GitHub Release with three assets, the APK, `update.json` and `SHA256SUMS.txt`. App updates use the same package and signing certificate, and Android asks for installation confirmation.

## Publishing a new APK

1. Put the signed `SafeLease-SG-<version>.apk` in `app/` and remove the old one.
2. Update `app/update.json` (versionCode, versionName, downloadUrl, size, sha256, release notes) and `app/SHA256SUMS.txt`.
3. Update the version, size and SHA-256 on `index.html`.
4. Run `python3 tools/verify_release.py --previous <last released APK>`. It refuses a file signed with a different certificate, because Android would reject that update.
5. Merge to `main`. The workflow verifies the files again, creates the release `v<versionName>` with the APK, `update.json`, `SHA256SUMS.txt` and a zip of the web app, marks it latest and checks the in-app update URL.

The workflow can also be started by hand from the Actions tab. When the release already exists it only uploads missing assets.

## Changing the web app

Bump `WEB_VERSION` in `web/core.js`, the cache name in `web/sw.js` and the version on `index.html` together. The verifier checks they match.

```
node --test tests/*.test.mjs
python3 -m http.server 8765 &
node tests/e2e.cjs http://localhost:8765/web/
```

The end-to-end test needs Playwright with Chromium. It uses Chromium's fake camera, so the move-in record can be walked from first photo to confirmation.
