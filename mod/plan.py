#!/usr/bin/env python3
"""Works out the build matrix for the companion mod.

Runs in CI (which has open network access) so nothing here has to be
hard-coded: for every Minecraft version we care about it asks Fabric's own
services which Yarn mappings, loader and Fabric API exist, and drops versions
that have none. Prints a GitHub Actions matrix as JSON on stdout.
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

MAVEN = "https://maven.fabricmc.net"
META = "https://meta.fabricmc.net/v2/versions"

# Known-good, hand-pinned rows (these shipped and work).
LEGACY = [
    dict(mc="1.20.1", yarn="1.20.1+build.10", loader="0.16.5", api="0.92.0+1.20.1"),
    dict(mc="1.20.4", yarn="1.20.4+build.3", loader="0.16.5", api="0.97.2+1.20.4"),
    dict(mc="1.21", yarn="1.21+build.9", loader="0.16.5", api="0.100.1+1.21"),
    dict(mc="1.21.1", yarn="1.21.1+build.3", loader="0.16.5", api="0.102.0+1.21.1"),
]
YARN_CANDIDATES = ["1.21.2", "1.21.3", "1.21.4", "1.21.5", "1.21.6", "1.21.7",
                   "1.21.8", "1.21.9", "1.21.10", "1.21.11"]
MOJANG_CANDIDATES = ["26.1", "26.1.1", "26.1.2", "26.2", "26.3"]


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def maven_versions(group_path, artifact):
    root = ET.fromstring(get(f"{MAVEN}/{group_path}/{artifact}/maven-metadata.xml"))
    return [v.text for v in root.iter("version")]


def vkey(v):
    return [int(x) if x.isdigit() else 0 for x in re.split(r"[.+\-]", v)]


def main():
    include_mojang = "--mojang" in sys.argv
    api_versions = maven_versions("net/fabricmc/fabric-api", "fabric-api")
    loom_versions = maven_versions("net/fabricmc", "fabric-loom")
    loader = next(x for x in json.loads(get(f"{META}/loader")) if x["stable"])["version"]

    def newest_api(mc):
        m = sorted((v for v in api_versions if v.endswith("+" + mc)), key=vkey)
        return m[-1] if m else None

    def newest_loom(max_minor):
        rel = [v for v in loom_versions
               if re.fullmatch(r"1\.\d+(\.\d+)?", v) and int(v.split(".")[1]) <= max_minor]
        rel.sort(key=vkey)
        return rel[-1]

    rows = []
    for r in LEGACY:
        rows.append(dict(mc=r["mc"], family="yarn", yarn=r["yarn"], loader=r["loader"], api=r["api"],
                         loom="1.7.4", gradle="8.10", java=21, dir="mod"))

    yarn_loom = newest_loom(13)
    for mc in YARN_CANDIDATES:
        yarn = json.loads(get(f"{META}/yarn/{mc}"))
        api = newest_api(mc)
        if not yarn or not api:
            print(f"skip {mc}: yarn={bool(yarn)} api={api}", file=sys.stderr)
            continue
        rows.append(dict(mc=mc, family="yarn", yarn=yarn[0]["version"], loader=loader, api=api,
                         loom=yarn_loom, gradle="8.14", java=21, dir="mod"))

    if include_mojang:
        mojang_loom = newest_loom(15)  # newer Loom needs a newer Gradle than the 26.1 guide pins
        for mc in MOJANG_CANDIDATES:
            api = newest_api(mc)
            if not api:
                print(f"skip {mc}: no fabric api", file=sys.stderr)
                continue
            rows.append(dict(mc=mc, family="mojang", yarn="", loader=loader, api=api,
                             loom=mojang_loom, gradle="9.4.0", java=25, dir="mod26"))

    print(json.dumps({"include": rows}))


main()
