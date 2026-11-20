# SPDX-License-Identifier: MPL-2.0
import importlib.util
import json
import hashlib
import shutil
import subprocess
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('adapter',Path(__file__).resolve().parents[1]/'scripts/audit_declared_references.py')
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
class DeclarationTests(unittest.TestCase):
    def test_current_declarations_cover_every_native_release_and_draft_axis(self):
        result=adapter.inventory();refs=result['references']
        self.assertGreaterEqual(len(refs),14)
        self.assertEqual({x['class']for x in refs},{'released-contract','draft-contract','conformance-suite','base-carrier','copied-tree'})
        self.assertEqual(len([x for x in refs if x['class']=='conformance-suite']),2)
        self.assertTrue(result['coverageGaps'])
    def test_unsafe_paths_refuse(self):
        for value in ['/outside','../outside','']:
            with self.assertRaises(ValueError):adapter.relative(value)
    def test_real_checker_pin_is_explicit(self):
        pin=json.loads((adapter.ROOT/'references/checker.json').read_text())
        self.assertEqual(pin['commit'],'6dee4c8baba723ec5cad825d521db2dbbc1921ae')
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                adapter.verify_checker(Path(tmp),dict(pin,repository='wrong/authority'))

    def test_declared_source_is_not_replaced_by_a_hardcoded_authority(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work)
            for name in ['schemas','drafts']:
                shutil.copytree(adapter.ROOT/name,root/name)
            for name in ['conformance','examples']:
                (root/name).mkdir()
                shutil.copyfile(adapter.ROOT/name/'provenance.json',root/name/'provenance.json')
            record=root/'examples/provenance.json'
            data=json.loads(record.read_text());data['source']['repository']='wrong-owner'
            record.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'authority'):
                adapter.inventory(root)

    def test_bootstrap_binds_bytes_to_immutable_git_object(self):
        with tempfile.TemporaryDirectory() as work:
            root=Path(work);source=root/'scripts/check_references.py'
            source.parent.mkdir();raw=b"# Independent bootstrap fixture\n";source.write_bytes(raw)
            def git(*args):
                return subprocess.check_output(['git','-C',work,*args],stderr=subprocess.DEVNULL)
            git('init','-q');git('add','scripts/check_references.py')
            git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Immutable fixture')
            pin={'repository':adapter.AUTHORITY,'path':'scripts/check_references.py',
                 'commit':git('rev-parse','HEAD').decode().strip(),'sha256':hashlib.sha256(raw).hexdigest()}
            self.assertEqual(adapter.verify_checker(root,pin),raw)
            source.write_bytes(raw+b'# changed\n')
            with self.assertRaisesRegex(ValueError,'immutable'):
                adapter.verify_checker(root,pin)
            source.unlink();other=root/'other.py';other.write_bytes(raw);source.symlink_to(other)
            with self.assertRaisesRegex(ValueError,'symlinks'):
                adapter.verify_checker(root,pin)
