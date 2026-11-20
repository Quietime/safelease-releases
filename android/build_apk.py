#!/usr/bin/env python3
"""Build the SafeLease SG Android APK from the released base APK plus changed web assets.

The Android app is a WebView shell. Its Java code has not changed since 1.5.1 (classes.dex is
byte-identical in 1.5.1 and 1.6.2), so a new version only needs new files under assets/ and a
new version in AndroidManifest.xml. This script rebuilds the APK from the signed base without
recompiling anything, so it needs no Android SDK platform.

  python3 android/build_apk.py build                 # dist/SafeLease-SG-<v>-unsigned.apk
  python3 android/build_apk.py sign --keystore K     # dist/SafeLease-SG-<v>.apk, signed v2 like the base
  python3 android/build_apk.py promote dist/SafeLease-SG-<v>.apk
  python3 android/build_apk.py extract DIR           # full asset tree for the browser QA harness

sign reads SAFELEASE_STORE_PASSWORD and SAFELEASE_KEY_PASSWORD and uses the alias "safelease",
the same names as the Gradle project. It refuses a key whose certificate differs from the one the
installed apps carry, because Android would reject that update. zipalign and apksigner come from
Android SDK build-tools (or the Debian packages of the same name).
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DIST = ROOT / "dist"
OVERLAY = HERE / "source" / "app" / "src" / "main" / "assets"  # the Gradle project assets; only files that differ from the base APK are swapped in
# Files MainActivity serves to the WebView. A file outside this list returns 404 in the app
# (the 1.5.0 regression), and the list lives in compiled Java, so the overlay may only replace these.
ALLOWLIST = {"index.html", "app.js", "app.css", "brand.css", "model.js", "Inter.woff2", "icon.svg", "icon-192.png", "icon-512.png",
             "android-store.js", "checklist-store.js", "checklist-ui.js", "listing-review-store.js", "listing-review-ui.js",
             "getting-started.js", "android-api.js", "android-seed.js", "android-demo.js"}
# Read through Native.asset() rather than served, so they may also be replaced.
NATIVE_READ = {"android-ui-copy.json", "historical-image-query.json"}

sys.path.insert(0, str(ROOT / "tools"))
from verify_release import signing_certs, manifest_attrs  # noqa: E402


def cfg():
    return json.loads((HERE / "version.json").read_text(encoding="utf-8"))


def base_apk():
    """The signed base APK: app/ if still there, else git history, else the GitHub release. Checked by SHA-256."""
    c = cfg()
    path = ROOT / c["base"]
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == c["baseSha256"]:
        return path
    cached = DIST / Path(c["base"]).name
    DIST.mkdir(exist_ok=True)
    if not (cached.exists() and hashlib.sha256(cached.read_bytes()).hexdigest() == c["baseSha256"]):
        data = None
        try:
            data = subprocess.run(["git", "-C", str(ROOT), "show", f"{c['baseGitCommit']}:{c['base']}"], capture_output=True, check=True).stdout
        except (subprocess.CalledProcessError, FileNotFoundError):
            import urllib.request
            print(f"fetching base APK from {c['baseUrl']}")
            data = urllib.request.urlopen(c["baseUrl"]).read()
        if hashlib.sha256(data).hexdigest() != c["baseSha256"]:
            sys.exit("base APK digest does not match android/version.json")
        cached.write_bytes(data)
    return cached


def overlay_files():
    """Asset files in the source tree whose bytes differ from the base APK."""
    with zipfile.ZipFile(base_apk()) as z:
        names = {i.filename for i in z.infolist()}
        files = sorted(p.name for p in OVERLAY.iterdir() if p.is_file()
                       and ("assets/" + p.name not in names or z.read("assets/" + p.name) != p.read_bytes()))
    bad = [f for f in files if f not in ALLOWLIST | NATIVE_READ]
    if bad:
        sys.exit(f"changed files outside the MainActivity allowlist would 404 in the app: {bad}")
    return files


def patch_manifest(data, old_name, new_name, new_code):
    """Change versionName and versionCode in a binary AndroidManifest.xml."""
    if len(old_name) != len(new_name):
        sys.exit("versionName must keep the same length as the base so the string pool stays valid")
    out = bytearray(data)
    off, strings, code_done = 8, [], False
    while off < len(out):
        ctype, _hsize, csize = struct.unpack_from("<HHI", out, off)
        if ctype == 0x0001:
            count, _style, flags, sstart = struct.unpack_from("<IIII", out, off + 8)
            utf8 = flags & 0x100
            for o in struct.unpack_from("<%dI" % count, out, off + 28):
                p = off + sstart + o
                if utf8:
                    p += 2 if out[p] & 0x80 else 1
                    n = out[p]
                    if n & 0x80:
                        n = ((n & 0x7F) << 8) | out[p + 1]; p += 2
                    else:
                        p += 1
                    raw, enc = bytes(out[p:p + n]), "utf-8"
                else:
                    (n,) = struct.unpack_from("<H", out, p); p += 2
                    raw, enc = bytes(out[p:p + 2 * n]), "utf-16-le"
                text = raw.decode(enc)
                strings.append(text)
                if text == old_name:
                    out[p:p + len(raw)] = new_name.encode(enc)
        elif ctype == 0x0102:
            (name_i,) = struct.unpack_from("<I", out, off + 20)
            astart, asize, acount = struct.unpack_from("<HHH", out, off + 24)
            if strings[name_i] == "manifest":
                base = off + 16 + astart
                for i in range(acount):
                    a = base + i * asize
                    if strings[struct.unpack_from("<I", out, a + 4)[0]] == "versionCode":
                        struct.pack_into("<I", out, a + 16, new_code)
                        code_done = True
        off += csize
    if old_name not in strings or not code_done:
        sys.exit("could not find versionName/versionCode in the base manifest")
    return bytes(out)


def tool(name):
    found = shutil.which(name)
    if found:
        return found
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        tools = sorted((Path(sdk) / "build-tools").glob(f"*/{name}"))
        if tools:
            return str(tools[-1])
    sys.exit(f"{name} not found. Install Android SDK build-tools or the {name} package.")


def build(out=None):
    c = cfg()
    base = base_apk()
    attrs = manifest_attrs(base)
    if (attrs.get("versionName"), attrs.get("versionCode")) != (c["baseVersionName"], c["baseVersionCode"]):
        sys.exit(f"base APK is {attrs.get('versionName')} ({attrs.get('versionCode')}), version.json expects {c['baseVersionName']}")
    files = overlay_files()
    DIST.mkdir(exist_ok=True)
    tmp = DIST / "unaligned.apk"
    out = Path(out) if out else DIST / f"SafeLease-SG-{c['versionName']}-unsigned.apk"
    replaced = set()
    with zipfile.ZipFile(base) as src, zipfile.ZipFile(tmp, "w") as dst:
        names = {i.filename for i in src.infolist()}
        missing = [f for f in files if "assets/" + f not in names]
        if missing:
            sys.exit(f"overlay files not present in the base APK: {missing}")
        for info in src.infolist():
            data = src.read(info)
            if info.filename == "AndroidManifest.xml":
                data = patch_manifest(data, c["baseVersionName"], c["versionName"], c["versionCode"])
            elif info.filename.startswith("assets/") and info.filename[7:] in files:
                data = (OVERLAY / info.filename[7:]).read_bytes()
                replaced.add(info.filename[7:])
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type, zi.external_attr, zi.create_system = info.compress_type, info.external_attr, info.create_system
            dst.writestr(zi, data)
    subprocess.run([tool("zipalign"), "-p", "-f", "4", str(tmp), str(out)], check=True)
    tmp.unlink()
    a = manifest_attrs(out)
    print(f"built {out.relative_to(ROOT)} · {a['package']} {a['versionName']} ({a['versionCode']}) · replaced {', '.join(sorted(replaced))}")
    return out


def sign(keystore, alias="safelease", allow_other_cert=False):
    c = cfg()
    unsigned = build()
    out = DIST / f"SafeLease-SG-{c['versionName']}.apk"
    for var in ("SAFELEASE_STORE_PASSWORD", "SAFELEASE_KEY_PASSWORD"):
        if not os.environ.get(var):
            sys.exit(f"set {var}")
    subprocess.run([tool("apksigner"), "sign", "--ks", keystore, "--ks-key-alias", alias,
                    "--ks-pass", "env:SAFELEASE_STORE_PASSWORD", "--key-pass", "env:SAFELEASE_KEY_PASSWORD",
                    "--v1-signing-enabled", "false", "--v2-signing-enabled", "true", "--v3-signing-enabled", "false", "--v4-signing-enabled", "false",
                    "--out", str(out), str(unsigned)], check=True)
    subprocess.run([tool("apksigner"), "verify", str(out)], check=True)
    certs = sorted({x for v in signing_certs(out).values() for x in v})
    if certs != [c["certificateSha256"]]:
        msg = f"signed with certificate {certs[0][:16]}…, but installed apps carry {c['certificateSha256'][:16]}…"
        if not allow_other_cert:
            out.unlink()
            sys.exit(msg + ". Android would refuse this update. Use the SafeLease release keystore.")
        print("WARNING " + msg + ". Test build only, never publish it.")
    print(f"signed {out.relative_to(ROOT)} · sha256 {hashlib.sha256(out.read_bytes()).hexdigest()}")
    return out


def promote(apk):
    """Put a signed APK into app/ and update the manifest, checksums and download page."""
    c = cfg()
    apk = Path(apk)
    certs = sorted({x for v in signing_certs(apk).values() for x in v})
    if certs != [c["certificateSha256"]]:
        sys.exit("refusing to publish an APK that is not signed with the release certificate")
    a = manifest_attrs(apk)
    if (a["versionName"], a["versionCode"]) != (c["versionName"], c["versionCode"]):
        sys.exit("APK version does not match android/version.json")
    upd_path = ROOT / "app/update.json"
    old = json.loads(upd_path.read_text(encoding="utf-8"))
    old_name = old["downloadUrl"].rsplit("/", 1)[-1]
    name = f"SafeLease-SG-{c['versionName']}.apk"
    blob = apk.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    shutil.copyfile(apk, ROOT / "app" / name)
    if old_name != name and (ROOT / "app" / old_name).exists():
        (ROOT / "app" / old_name).unlink()
    new = dict(old, versionCode=c["versionCode"], versionName=c["versionName"], size=len(blob), sha256=digest,
               downloadUrl=f"https://github.com/Quietime/safelease-releases/releases/download/v{c['versionName']}/{name}",
               releaseNotes=c["releaseNotes"])
    upd_path.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "app/SHA256SUMS.txt").write_text(f"{digest}  {name}\n", encoding="utf-8")
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    old_mb, new_mb = f"{old['size'] / 1048576:.1f} MB", f"{len(blob) / 1048576:.1f} MB"
    page = page.replace(old["sha256"], digest).replace(old_name, name).replace(old_mb, new_mb)
    page = page.replace(f"Version {old['versionName']}</span>", f"Version {c['versionName']}</span>")
    notes = (f"<!-- apk-notes -->\n      <p>{c['releaseNotes']['en']}</p>\n      <p>{c['releaseNotes']['zh']}</p>\n      <!-- /apk-notes -->")
    page, n = re.subn(r"<!-- apk-notes -->.*?<!-- /apk-notes -->", notes, page, flags=re.S)
    if n != 1:
        sys.exit("index.html has no <!-- apk-notes --> block")
    (ROOT / "index.html").write_text(page, encoding="utf-8")
    print(f"promoted {name} · {len(blob)} bytes · sha256 {digest}")
    print("next: python3 tools/verify_release.py --previous <the previously released APK>, then merge to main")


def extract(target):
    target = Path(target)
    c = cfg()
    files = overlay_files()
    with zipfile.ZipFile(base_apk()) as z:
        for info in z.infolist():
            if info.filename.startswith("assets/") and not info.is_dir():
                dest = target / info.filename[7:]
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(z.read(info))
    for f in files:
        shutil.copyfile(OVERLAY / f, target / f)
    (target / "allowlist.json").write_text(json.dumps(sorted(ALLOWLIST)), encoding="utf-8")
    print(f"extracted assets to {target}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build")
    s = sub.add_parser("sign")
    s.add_argument("--keystore", required=True)
    s.add_argument("--alias", default="safelease")
    s.add_argument("--allow-other-cert", action="store_true", help="test builds only; the result can never update installed apps")
    p = sub.add_parser("promote")
    p.add_argument("apk")
    e = sub.add_parser("extract")
    e.add_argument("dir")
    args = ap.parse_args()
    if args.cmd == "build":
        build()
    elif args.cmd == "sign":
        sign(args.keystore, args.alias, args.allow_other_cert)
    elif args.cmd == "promote":
        promote(args.apk)
    else:
        extract(args.dir)


if __name__ == "__main__":
    main()
