#!/usr/bin/env python3
"""Check that the Android release files in app/ agree with each other.

Run from the repository root:  python3 tools/verify_release.py [--previous OLD.apk]

Checks
  * app/update.json points at the APK in app/ (name, size, SHA-256, package, versionCode, versionName)
  * app/SHA256SUMS.txt lists the same digest
  * the APK carries an APK Signature Scheme v2 or v3 block
  * with --previous, the signing certificate is identical to the earlier APK,
    so Android will accept the file as an in-place update
  * index.html (landing page) quotes the current APK file name and digest
  * web/ app version agrees between core.js, sw.js and the landing page

Prints a short report and exits non-zero on the first category of failure.
Only the Python standard library is used.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APK_SIG_MAGIC = b"APK Sig Block 42"
SCHEMES = {0x7109871A: "v2", 0xF05368C0: "v3", 0x1B93AD61: "v3.1"}


def fail(msg):
    print("FAIL  " + msg)
    sys.exit(1)


def ok(msg):
    print("ok    " + msg)


# ---------- APK signing block ----------

def _lp(buf, off):
    (n,) = struct.unpack_from("<I", buf, off)
    return buf[off + 4: off + 4 + n], off + 4 + n


def _seq(buf):
    out, off = [], 0
    while off < len(buf):
        item, off = _lp(buf, off)
        out.append(item)
    return out


def signing_certs(path):
    data = Path(path).read_bytes()
    eocd = data.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise ValueError("no end of central directory")
    (cd_offset,) = struct.unpack_from("<I", data, eocd + 16)
    if data[cd_offset - 16: cd_offset] != APK_SIG_MAGIC:
        return {}
    (size,) = struct.unpack_from("<Q", data, cd_offset - 24)
    start = cd_offset - (size + 8)
    pairs = data[start + 8: cd_offset - 24]
    certs, off = {}, 0
    while off < len(pairs):
        (n,) = struct.unpack_from("<Q", pairs, off)
        (pid,) = struct.unpack_from("<I", pairs, off + 8)
        value = pairs[off + 12: off + 8 + n]
        off += 8 + n
        if pid not in SCHEMES:
            continue
        signers, _ = _lp(value, 0)
        found = []
        for signer in _seq(signers):
            signed_data, _ = _lp(signer, 0)
            _digests, p = _lp(signed_data, 0)
            cert_seq, _ = _lp(signed_data, p)
            found += [hashlib.sha256(c).hexdigest() for c in _seq(cert_seq)]
        certs[SCHEMES[pid]] = found
    return certs


# ---------- binary AndroidManifest.xml ----------

def manifest_attrs(apk):
    with zipfile.ZipFile(apk) as z:
        x = z.read("AndroidManifest.xml")
    strings, attrs, off = [], {}, 8
    while off < len(x):
        ctype, hsize, csize = struct.unpack_from("<HHI", x, off)
        if ctype == 0x0001:  # string pool
            count, _style, flags, sstart = struct.unpack_from("<IIII", x, off + 8)
            utf8 = flags & 0x100
            offsets = struct.unpack_from("<%dI" % count, x, off + 28)
            for o in offsets:
                p = off + sstart + o
                if utf8:
                    n = x[p]; p += 2 if n & 0x80 else 1
                    n = x[p]
                    if n & 0x80:
                        n = ((n & 0x7F) << 8) | x[p + 1]; p += 2
                    else:
                        p += 1
                    strings.append(x[p:p + n].decode("utf-8", "replace"))
                else:
                    (n,) = struct.unpack_from("<H", x, p); p += 2
                    if n & 0x8000:
                        (lo,) = struct.unpack_from("<H", x, p); n = ((n & 0x7FFF) << 16) | lo; p += 2
                    strings.append(x[p:p + 2 * n].decode("utf-16-le", "replace"))
        elif ctype == 0x0102:  # start element
            (name_i,) = struct.unpack_from("<I", x, off + 20)
            astart, asize, acount = struct.unpack_from("<HHH", x, off + 24)
            if strings[name_i] == "manifest":
                base = off + 16 + astart
                for i in range(acount):
                    _ns, an, raw, _sz, _r, dtype, dval = struct.unpack_from("<IIIHBBI", x, base + i * asize)
                    key = strings[an]
                    attrs[key] = strings[raw] if raw != 0xFFFFFFFF else (dval if dtype == 0x10 else strings[dval] if dtype == 0x03 else dval)
                return attrs
        off += csize
    return attrs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--previous", help="earlier signed APK to compare signing certificates with")
    args = ap.parse_args()

    update = json.loads((ROOT / "app/update.json").read_text(encoding="utf-8"))
    name = update["downloadUrl"].rsplit("/", 1)[-1]
    tag = update["downloadUrl"].rsplit("/", 2)[-2]
    apk = ROOT / "app" / name
    if not apk.exists():
        fail(f"update.json points at {name}, which is not in app/")
    if tag != "v" + update["versionName"]:
        fail(f"download URL tag {tag} does not match versionName {update['versionName']}")
    blob = apk.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    if len(blob) != update["size"]:
        fail(f"size {len(blob)} != update.json size {update['size']}")
    if digest != update["sha256"]:
        fail(f"sha256 {digest} != update.json sha256")
    ok(f"{name}: {len(blob)} bytes, sha256 {digest[:16]}…")

    sums = (ROOT / "app/SHA256SUMS.txt").read_text(encoding="utf-8").split()
    if sums[:2] != [digest, name]:
        fail("app/SHA256SUMS.txt does not list the current APK digest")
    ok("SHA256SUMS.txt matches")

    attrs = manifest_attrs(apk)
    if attrs.get("package") != update["packageName"]:
        fail(f"package {attrs.get('package')} != {update['packageName']}")
    if int(attrs.get("versionCode", -1)) != update["versionCode"]:
        fail(f"versionCode {attrs.get('versionCode')} != {update['versionCode']}")
    if str(attrs.get("versionName")) != update["versionName"]:
        fail(f"versionName {attrs.get('versionName')} != {update['versionName']}")
    ok(f"manifest {attrs['package']} {attrs['versionName']} ({attrs['versionCode']})")

    certs = signing_certs(apk)
    if not certs:
        fail("APK has no v2/v3 signature block")
    current = sorted({c for v in certs.values() for c in v})
    ok(f"signed with {', '.join(sorted(certs))}; certificate sha256 {current[0][:16]}…")
    if args.previous:
        prev = sorted({c for v in signing_certs(args.previous).values() for c in v})
        if prev != current:
            fail("signing certificate differs from the previous APK; Android will refuse the update")
        ok("signing certificate identical to previous release")

    landing = (ROOT / "index.html").read_text(encoding="utf-8")
    if name not in landing or digest not in landing:
        fail("index.html does not quote the current APK name and SHA-256")
    ok("landing page quotes current APK")

    core = (ROOT / "web/core.js").read_text(encoding="utf-8")
    sw = (ROOT / "web/sw.js").read_text(encoding="utf-8")
    m = re.search(r"WEB_VERSION\s*=\s*['\"]([\d.]+)['\"]", core)
    if not m:
        fail("web/core.js has no WEB_VERSION")
    web = m.group(1)
    if f"safelease-v{web}" not in sw:
        fail(f"web/sw.js cache name does not match web version {web}")
    if f"Version {web}" not in landing:
        fail(f"index.html does not show web version {web}")
    ok(f"web app {web} consistent across core.js, sw.js and landing page")
    print(json.dumps({"tag": tag, "apk": name, "web": web}))


if __name__ == "__main__":
    main()
