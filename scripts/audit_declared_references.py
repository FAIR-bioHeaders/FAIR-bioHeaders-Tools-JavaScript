#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. https://mozilla.org/MPL/2.0/.
"""Audit JavaScript native declarations without writing any pin."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONSUMER = "FAIR-bioHeaders/FAIR-bioHeaders-Tools-JavaScript"
AUTHORITY = "FAIR-bioHeaders/FAIR-bioHeaders-Specification"
RECORD = "schemas/provenance.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def relative(value):
    item = PurePosixPath(value)
    if not value or item.is_absolute() or ".." in item.parts:
        raise ValueError("unsafe declaration path")
    return str(item)


def inventory(root=ROOT):
    rows, records = [], []
    def read(name):
        raw = (root / name).read_bytes()
        records.append({'path': name, 'sha256': digest(raw)})
        return json.loads(raw)
    def row(identity, cls, repo, revision, kind, commit, files, record, **extra):
        rows.append(dict(id=identity, consumer=CONSUMER, record=record, repository=repo,
                         revision=revision, revisionKind=kind, commit=commit,
                         files=files, **{'class':cls}, **extra))
    def authority(url, expected):
        if url.rstrip('/').removesuffix('.git') != 'https://github.com/' + expected:
            raise ValueError('unexpected declared authority: ' + url)
    name='schemas/provenance.json'; schemas=read(name)
    authority(schemas['source']['url'], AUTHORITY)
    if schemas['source'].get('repository') not in (None, AUTHORITY, AUTHORITY.split('/')[1]):
        raise ValueError('schema authority declarations disagree')
    for tag, release in schemas['releases'].items():
        files=[{'path':relative(v['sourcePath']), 'local':'schemas/'+relative(v['file']),
                'sha256':v['sha256']} for k,v in release.items() if k!='commit']
        row('schemas-'+tag, 'released-contract', AUTHORITY, tag, 'tag', release.get('commit'), files, name)
    name='drafts/provenance.json'; drafts=read(name)['drafts']
    for typ,draft in drafts.items():
        repo='FAIR-bioHeaders/'+draft['repository']
        expected = {'FHT':'FAIR-bioHeaders/FHT-Specification','FHGM':'FAIR-bioHeaders/FHGM-Specification'}.get(typ)
        if repo != expected:
            raise ValueError('draft owner does not match type')
        authority(draft['repositoryUrl'],repo)
        for suffix,pin in [('contract',draft),('transport',draft.get('transportOverlay'))]:
            if not pin:continue
            row(typ+'-'+suffix,'draft-contract',repo,pin['commit'],'commit',pin['commit'],
                [{'path':relative(pin['sourcePath']),'local':'drafts/'+relative(pin['file']),'sha256':pin['sha256']}],name)
        row(typ+'-suite','conformance-suite',repo,draft['suiteCommit'],'commit',draft['suiteCommit'],
            [{'path':relative(draft['suiteManifest']), 'sha256':draft['suiteManifestSha256']}],name)
    overlay = drafts.get('FHGM', {}).get('transportOverlay')
    if overlay:
        declared = json.loads((root / 'drafts' / relative(overlay['file'])).read_text())
        tags = sorted(set(re.findall(r'/(v[0-9]+\.[0-9]+\.[0-9]+)(?:/|"|$)', json.dumps(declared))))
        for tag in tags:
            base = schemas['releases'][tag]
            pin = base['FHGFF3']
            row('FHGM-base-'+tag,'base-carrier',AUTHORITY,tag,'tag',base.get('commit'),
                [{'path':relative(pin['sourcePath']),'local':'schemas/'+relative(pin['file']),'sha256':pin['sha256']}],
                'drafts/provenance.json + schemas/provenance.json')
    for name,local,sourcekey in [('conformance/provenance.json','conformance','ref'),
                                 ('examples/provenance.json','examples','release')]:
        data=read(name); source=data['source']
        if source.get('repository') not in (AUTHORITY, AUTHORITY.split('/')[1]):
            raise ValueError('copied tree authority is not the shared publisher')
        if source.get('url'): authority(source['url'],AUTHORITY)
        if local=='conformance':
            files=[{'path':'conformance/'+relative(k),'local':'conformance/'+relative(k),'sha256':v}
                   for k,v in data['perFile'].items()]
        else:
            files=[{'path':relative(v['sourcePath']),'local':'examples/'+relative(k),'sha256':v['sha256']}
                   for k,v in data['files'].items()]
        row(local+'-copies','copied-tree',AUTHORITY,source[sourcekey],'tag',source['commit'],files,name,
            materialStatus='released',sourcePatterns=[x['path'] for x in files],localTree=local,
            localExclusions=[name])
    if (root/'reader-policy/provenance.json').exists():
        name='reader-policy/provenance.json';data=read(name)
        row('adopted-reader-policy','copied-tree',AUTHORITY,data['commit'],'commit',data['commit'],
            data['files'],name,materialStatus='historical',sourcePatterns=[x['path'] for x in data['files']])
    return {'inventoryVersion':1,'advisory':True,'declarationRecords':records,'references':rows,
            'coverageGaps':[{'scope':'Owning suites are external, not vendored',
                            'disposition':'Manifest authorities checked; native draft runners verify fixture reads at their immutable suite pins.'},
                           {'scope':'Native raw-main selector aliases',
                            'disposition':'Released current alias resolves existing current schema copies audited against their registered release tag; no live-main authority comparison substitutes for a tag.'}]}


def verify_checker(checkout, metadata):
    checkout = checkout.resolve()
    if (metadata["repository"] != AUTHORITY
            or metadata["path"] != "scripts/check_references.py"
            or not re.fullmatch(r"[0-9a-f]{40}", metadata["commit"])
            or not re.fullmatch(r"[0-9a-f]{64}", metadata["sha256"])):
        raise ValueError("invalid checker source pin")
    environment = {**os.environ, "GIT_NO_REPLACE_OBJECTS": "1", "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0"}
    head = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], env=environment).decode().strip()
    if head != metadata["commit"]:
        raise ValueError("checker checkout HEAD does not match the declared source commit")
    name = relative(metadata["path"])
    source = checkout / name
    if source.resolve() != source:
        raise ValueError("checker source path must not traverse symlinks")
    raw = source.read_bytes()
    immutable = subprocess.check_output(["git", "-C", str(checkout), "show", f"{head}:{name}"], env=environment)
    if source.is_symlink() or raw != immutable or digest(raw) != metadata["sha256"]:
        raise ValueError("checker file does not match its immutable source/digest")
    return immutable


def audit(checkout, mappings=(), root=ROOT, strict=False):
    metadata = json.loads((root / "references/checker.json").read_text())
    checker_bytes = verify_checker(checkout, metadata)
    table = inventory(root)
    with tempfile.TemporaryDirectory(prefix="js-declared-references-") as work:
        generated = Path(work) / "inventory.json"
        generated.write_text(json.dumps(table, indent=2) + "\n")
        checker = Path(work) / "verified_check_references.py"
        checker.write_bytes(checker_bytes)
        checker.chmod(0o400)
        command = [sys.executable, "-I", str(checker), "--inventory", str(generated),
                   "--consumer", CONSUMER, "--consumer-root", str(root.resolve())]
        for mapping in mappings:
            command.extend(["--checkout", mapping])
        # Isolated Python does not import neighboring unverified helper modules.
        result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError("verified checker failed to produce an advisory report: " + result.stderr.strip())
    report = json.loads(result.stdout)
    if len(report.get("references", [])) != len(table["references"]):
        raise RuntimeError("checker did not report every declared reference group")
    report.update(consumer=CONSUMER, checkerSource=metadata,
                  declarationRecords=table["declarationRecords"])
    return report, int(strict and any(row["verdict"] != "FRESH" for row in report["references"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checker-root", type=Path, required=True)
    parser.add_argument("--checkout", action="append", default=[], metavar="OWNER/REPO=PATH")
    parser.add_argument("--exit-on-findings", action="store_true", help="controlled offline check; scheduled audit stays advisory")
    parser.add_argument("--report-output", type=Path, help="atomic report outside the source checkout")
    args = parser.parse_args()
    if args.report_output:
        if args.report_output.resolve().is_relative_to(ROOT.resolve()):
            parser.error("report output must remain outside the source checkout")
        args.report_output.unlink(missing_ok=True)
    try:
        report, status = audit(args.checker_root, args.checkout, strict=args.exit_on_findings)
    except FileNotFoundError as exc:
        missing_declaration = bool(exc.filename) and Path(exc.filename).resolve() == (ROOT / RECORD).resolve()
        report = {"advisory": True, "wrote": [], "references": [{"id": "js-declarations",
                  "verdict": "ABSENT" if missing_declaration else "QUERY_FAILED",
                  "localComparison": "not-run", "reason": str(exc)}]}
        status = int(args.exit_on_findings) if missing_declaration else 1
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError, RuntimeError) as exc:
        report = {"advisory": True, "wrote": [], "references": [{"id": "js-audit-bootstrap",
                  "verdict": "QUERY_FAILED", "localComparison": "not-run", "reason": str(exc)}]}
        status = 1
    text = json.dumps(report, indent=2) + "\n"
    if args.report_output:
        args.report_output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=args.report_output.parent, delete=False) as stream:
            stream.write(text)
            temporary = Path(stream.name)
        temporary.replace(args.report_output)
    print(text, end="")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
