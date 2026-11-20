# SafeLease SG Android 1.7.0

The Android app is a WebView shell around web assets. Its Java code has not changed since 1.5.1, and `classes.dex` is byte-identical in 1.5.1 and 1.6.2. So 1.7.0 is built from the signed 1.6.2 APK by replacing asset files and the version in `AndroidManifest.xml`. Nothing is recompiled.

| Path | What it is |
| --- | --- |
| `version.json` | New version, base APK, release certificate and release notes |
| `assets/` | Full copies of the assets that differ from 1.5.1 (`app.css` is the 1.6.2 file, unchanged). Only files MainActivity already serves can go here |
| `build_apk.py` | `build`, `sign`, `promote` and `extract` |
| `qa/` | Browser harness (node:sqlite bridge, same allowlist as MainActivity) and the 1.7.0 acceptance walk |
| `CHANGELOG-1.7.0.md` | What changed and how it was checked |

## Signing

An update only installs over the existing app when it carries the same certificate as earlier releases (SHA-256 `772db9f5…c1b16a`, CN=SafeLease SG). The keystore is not in this repository, so the APK must be signed by its owner. `build_apk.py sign` and `promote` both refuse any other certificate.

**Option A, GitHub signs it.** Add three repository secrets under Settings, Secrets and variables, Actions.

- `SAFELEASE_KEYSTORE_B64` holds the keystore file as base64 (`base64 -w0 safelease.jks` on Linux, `[Convert]::ToBase64String([IO.File]::ReadAllBytes("safelease.jks"))` in PowerShell)
- `SAFELEASE_STORE_PASSWORD`
- `SAFELEASE_KEY_PASSWORD`

The next push to a branch other than main then signs the build, checks the certificate and commits the APK, `update.json`, `SHA256SUMS.txt` and the download page to that branch, as long as `version.json` is newer than the published `app/update.json`. You can also run the "Build Android APK" workflow by hand with **promote** ticked. Merging the PR publishes v1.7.0 through the release workflow.

**Option B, sign on your own computer.** You need Python 3 and Android SDK build-tools (for `zipalign` and `apksigner`).

```
set SAFELEASE_STORE_PASSWORD=...      (PowerShell: $env:SAFELEASE_STORE_PASSWORD="...")
set SAFELEASE_KEY_PASSWORD=...
python android/build_apk.py sign --keystore path\to\safelease.jks
python android/build_apk.py promote dist/SafeLease-SG-1.7.0.apk
python tools/verify_release.py --previous <the 1.6.2 or 1.5.1 APK>
```

Commit `app/` and `index.html`, then merge.

**Option C, the Gradle project.** Copy the five files in `assets/` over `app/src/main/assets/` of the 1.5.1 source project (they include the 1.6.2 changes), set `versionCode 17000` and `versionName '1.7.0'` in `app/build.gradle`, and run `gradlew.bat :app:assembleRelease` with the usual signing variables.

## Testing

```
python3 android/build_apk.py extract dist/android-assets
node android/qa/test-android.mjs dist/android-assets
```

The harness runs the real bundled JavaScript and SQLite migrations but fakes the Android side. Activity recreation, the physical camera, file save dialogs and the installer still need a device.

## The next version

Edit the files in `assets/`, bump `versionName` (same length, for example 1.7.1) and `versionCode` in `version.json`, and update the release notes. After 1.7.0 is published you may switch `base` to the 1.7.0 APK. Then set `baseSha256`, `baseGitCommit`, `baseUrl`, `baseVersionName` and `baseVersionCode` to match.
