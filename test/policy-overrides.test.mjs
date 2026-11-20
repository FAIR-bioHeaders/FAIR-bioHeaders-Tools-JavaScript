// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const repo=fileURLToPath(new URL('../',import.meta.url));

test('retirement and historical differential are qualified by original bytes',()=>{
 const work=mkdtempSync(join(tmpdir(),'js-policy-boundary-'));
 try{
  const suite=join(work,'suite');mkdirSync(suite);
  const entry=JSON.parse(readFileSync(join(repo,'reader-policy/counterparts.json'))).vectors.find(x=>x.id==='fhp-fasta-lf-canonical-parent');
  const vector={...entry,id:'fhp-fasta-lf',file:'input.fasta'};
  writeFileSync(join(suite,'manifest.json'),JSON.stringify({vectors:[vector]}));
  const bin=join(work,'oracle');mkdirSync(bin);
  for(const name of ['fhr-fasta-validate','fhr-fasta-strip']){
   const file=join(bin,name);
   const code=name.endsWith('validate')?'process.exit(0);':"const fs=require('node:fs');fs.writeFileSync(process.argv[3],fs.readFileSync(process.argv[2],'utf8').split('\\n').filter(x=>!x.startsWith(';~')).join('\\n'));";
   writeFileSync(file,'#!/usr/bin/env node\n'+code+'\n');chmodSync(file,0o755);
  }
  const inputs=[
   readFileSync(join(repo,'reader-policy/counterparts',entry.file)),
   readFileSync(join(repo,'conformance/valid/fhp-fasta-lf.fhp.fasta')),
  ];
  for(const bytes of inputs){
   writeFileSync(join(suite,'input.fasta'),bytes);
   const conformance=spawnSync(process.execPath,[join(repo,'scripts/run-conformance.mjs'),'--suite',suite],{encoding:'utf8'});
   assert.equal(conformance.status,0,conformance.stdout+conformance.stderr);
   const differential=spawnSync(process.execPath,[join(repo,'scripts/capability/toolkit-crosscheck.mjs'),suite],{encoding:'utf8',env:{...process.env,FHR_TOOLKIT_BIN:bin}});
   assert.equal(differential.status,0,differential.stdout+differential.stderr);
  }
 }finally{rmSync(work,{recursive:true,force:true});}
});
