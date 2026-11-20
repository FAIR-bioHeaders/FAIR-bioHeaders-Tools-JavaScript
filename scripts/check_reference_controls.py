# SPDX-License-Identifier: MPL-2.0
"""Run actual pinned checker on independent Git fixtures; never gate real drift."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from audit_declared_references import AUTHORITY, ROOT, audit


def run_controls(checker):
    with tempfile.TemporaryDirectory() as tmp:
        base=Path(tmp); authority=base/'authority'; authority.mkdir(); root=base/'consumer'
        def git(*args):
            return subprocess.check_output(['git','-C',str(authority),*args],stderr=subprocess.DEVNULL)
        git('init','-q')
        raw=b'{"fixture":true}\n'
        for name in ['fhr.json','conformance/manifest.json','examples/minimal.json']:
            p=authority/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        git('add','.')
        git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixed authority')
        commit=git('rev-parse','HEAD').decode().strip();git('tag','v9.9.9')
        sha=hashlib.sha256(raw).hexdigest()
        records={
          'schemas/provenance.json':{'source':{'url':'https://github.com/'+AUTHORITY},'releases':{'v9.9.9':{'commit':commit,'FHR':{'sourcePath':'fhr.json','file':'fhr.json','sha256':sha}}}},
          'drafts/provenance.json':{'drafts':{}},
          'conformance/provenance.json':{'source':{'repository':AUTHORITY,'url':'https://github.com/'+AUTHORITY,'ref':'v9.9.9','commit':commit},'perFile':{'manifest.json':sha}},
          'examples/provenance.json':{'source':{'repository':'FAIR-bioHeaders-Specification','release':'v9.9.9','commit':commit},'files':{'minimal.json':{'sourcePath':'examples/minimal.json','sha256':sha}}}}
        for name,record in records.items():
            p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(record))
        for name in ['schemas/fhr.json','conformance/manifest.json','examples/minimal.json']:
            (root/name).write_bytes(raw)
        (root/'references').mkdir();(root/'references/checker.json').write_bytes((ROOT/'references/checker.json').read_bytes())
        policy=root/'reader-policy';(policy/'payloads').mkdir(parents=True)
        (policy/'payloads/fixture.json').write_bytes(raw)
        policy_record={'repository':AUTHORITY,'commit':commit,'files':[{
            'path':'fhr.json','local':'reader-policy/payloads/fixture.json','sha256':sha}]}
        policy_provenance=policy/'provenance.json';policy_provenance.write_text(json.dumps(policy_record))
        mapping=[AUTHORITY+'='+str(authority)]
        def execute():return audit(checker,mapping,root=root,strict=True)
        report,status=execute();assert status==0 and len(report['references'])==4,report
        assert all(x['negativeControl']=='confirmed-missing' for x in report['references'])
        original_policy=policy_provenance.read_bytes();policy_provenance.unlink()
        missing,status=execute();assert status==1
        assert next(x for x in missing['references'] if x['id']=='adopted-reader-policy')['verdict']=='ABSENT'
        policy_provenance.write_bytes(original_policy)
        unexpected=policy/'payloads/unrecorded.json';unexpected.write_bytes(raw)
        omitted,status=execute();assert status==1
        assert next(x for x in omitted['references'] if x['id']=='adopted-reader-policy')['verdict']=='DRIFT'
        unexpected.unlink()
        wrong=copy.deepcopy(policy_record);wrong['repository']='wrong/publisher';policy_provenance.write_text(json.dumps(wrong))
        try:execute()
        except ValueError as error:assert 'publisher' in str(error)
        else:raise AssertionError('declared wrong publisher was replaced silently')
        policy_provenance.write_bytes(original_policy)
        p=root/'schemas/provenance.json';initial=p.read_bytes();d=copy.deepcopy(records['schemas/provenance.json'])
        d['releases']['v9.9.9']['FHR']['sha256']='0'*64;p.write_text(json.dumps(d));assert p.read_bytes()!=initial
        report,status=execute();assert status==1 and report['references'][0]['verdict']=='DRIFT'
        d=copy.deepcopy(records['schemas/provenance.json']);d['releases']['v9.9.9'].pop('commit');p.write_text(json.dumps(d))
        report,status=execute();assert status==1 and report['references'][0]['verdict']=='ABSENT'
        p.write_bytes(initial);(root/'schemas/fhr.json').unlink()
        report,status=execute();assert status==1 and report['references'][0]['verdict']=='ABSENT'
        return {'freshGroups':4,'404Controls':4,'missingPolicyDeclaration':'ABSENT','unrecordedPolicyPayload':'DRIFT','wrongPolicyPublisher':'refused','changedDigest':'DRIFT','missingTagCommit':'ABSENT','missingLocal':'ABSENT','pinWrites':[]}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--checker-root',type=Path,required=True)
    print(json.dumps(run_controls(p.parse_args().checker_root),indent=2))
