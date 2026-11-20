# SafeLease SG 1.7.0 for Android

Install SafeLease-SG-1.7.0.apk over the existing app to preserve records. See CHANGELOG-1.7.0.md. Assets include the 1.6.2 Deduction Check changes and the 1.7.0 flow and interface changes; Java code is unchanged since 1.5.1.

This update adds an isolated demo workspace, seven prepared scenarios, three practice roles, bilingual introductions and five new-user tasks. Task progress is scoped by account/workspace and counts new stored actions after first opening the guide. Demo role login is rejected in the personal workspace. Original photos, hashes and decisions remain unchanged.

Build with JDK17, Android SDK36 and the Gradle wrapper. Set local.properties locally. Release signing reads SAFELEASE_STORE_FILE, SAFELEASE_STORE_PASSWORD and SAFELEASE_KEY_PASSWORD, alias safelease. No signing secrets are included. Run gradlew.bat :app:lintDebug :app:assembleRelease and node --test tests/model.test.cjs.

qa/v151 contains 18 browser/SQLite integration checks and screenshots. The test bridge uses actual bundled application JavaScript and SQLite but simulates Android Native. Native Activity recreation, physical camera and installer are not accepted by those checks. No Android device was connected this round. The separate QA archive preserves this scope. Historical QA results describe earlier versions.

1.5.1 fixes the native asset allowlist omission that prevented both feature entries from loading. The regression harness now enforces the actual Java resource allowlist.
