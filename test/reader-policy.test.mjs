// SPDX-License-Identifier: MPL-2.0
/** Exact adopted D9/D10 shared corpus; metadata and transport are separate paths. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {inspectBytes,inspectStream} from '../src/reader.js';
import {selectSchema} from '../src/selection.js';
import {validateRecord} from '../src/validate.js';
import {loadHeaderYaml} from '../src/yaml.js';
import {HeaderError} from '../src/errors.js';
const root=new URL('../reader-policy/',import.meta.url);
const data=JSON.parse(readFileSync(new URL('cases.json',root)));
for(const entry of data.cases) test(`adopted policy ${entry.id}`,async()=>{
 const bytes=readFileSync(new URL(entry.file,root));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
 let observed; let findings=[]; let unsupported=false;
 try {
  if(entry.operation==='metadata'){
   const record=entry.serialization==='yaml'?loadHeaderYaml(bytes.toString()).metadata:JSON.parse(bytes);
   const selected=selectSchema(record);
   if(entry.rule==='V3')assert.equal(selected.release,'v0.4.0');
   const result=validateRecord(record,selected);observed=result.valid;findings=result.errors;
  }else{
   const container=entry.format==='fhp-fasta'?'fasta':entry.format==='fhgff3'?'gff3':entry.format;
   const reading=inspectBytes(bytes,{container});observed=reading.valid;findings=reading.errors;
   async function* chunks(){for(let n=0;n<bytes.length;n+=7)yield bytes.subarray(n,n+7);}
   const streamed=await inspectStream(chunks(),{container});
   assert.equal(streamed.valid,observed,'stream and byte reader agree');
  }
 }catch(error){
  if(!(error instanceof HeaderError))throw error;
  observed=false; findings=[error.message]; unsupported=error.result==='unsupported-version';
 }
 assert.equal(observed,entry.expected==='valid',entry.id);
 if(entry.rule==='V4')assert.ok(unsupported,'unknown or absent type release must be unsupported, not generic rejection');
 if(entry.expected==='invalid'&&['R1','R4','R12'].includes(entry.rule))assert.ok(findings.some(x=>x.includes(entry.rule)),entry.id+': rejection must name its primary reader policy');
});

const counterparts=JSON.parse(readFileSync(new URL('counterparts.json',root))).vectors;
for(const entry of counterparts)test(`canonical counterpart ${entry.id}`,()=>{
 const bytes=readFileSync(new URL('counterparts/'+entry.file,root));
 const expectedDigest=JSON.parse(readFileSync(new URL('retirement-crosswalk.json',root))).cases.find(x=>x.replacedBy===entry.id).replacementSha256;
 assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedDigest);
 const container=entry.format==='fhp-fasta'?'fasta':entry.format==='fhgff3'?'gff3':entry.format;
 const reading=inspectBytes(bytes,{container});
 assert.equal(reading.valid,entry.expected==='valid',reading.errors.join('; '));
 if(entry.expected==='valid'){
  assert.equal(reading.checksum.computed,entry.checksum);
  for(const [key,value]of Object.entries(entry.metadata??{}))assert.deepEqual(reading.metadata[key],value);
 }
 if(entry.result==='unsupported-version')assert.match(reading.errors.join('; '),/unsupported schema version/);
});

test('opaque extension checksum names do not acquire R4 semantics',()=>{
 const record=JSON.parse(readFileSync(new URL('payloads/fhr-metadata-canonical-checksum.json',root)));
 record['x-opaque']={checksum:'not-a-standard-checksum',nested:[{checksum:false,count:0}]};
 const before=JSON.stringify(record);
 assert.equal(validateRecord(record,selectSchema(record)).valid,true);
 assert.equal(JSON.stringify(record),before,'runtime validation preserves supplied extension values');
});

test('complete policy and counterpart ledgers cannot silently disappear',()=>{
 assert.equal(data.cases.length,64);
 assert.equal(new Set(data.cases.map(x=>x.id)).size,64);
 const retired=JSON.parse(readFileSync(new URL('retirement-crosswalk.json',root))).cases;
 assert.equal(retired.length,78);
 assert.deepEqual(counterparts.map(x=>x.id).sort(),retired.map(x=>x.replacedBy).sort());
 for(const entry of counterparts){
  const source=retired.find(x=>x.replacedBy===entry.id);
  assert.equal(entry.file,source.replacementFile);
  assert.equal(entry.expected,source.expected);
 }
});
test('BOM does not exempt forbidden YAML document syntax',()=>{
 for(const source of ['\uFEFF---\na: 1\n','\uFEFF%YAML 1.2\n---\na: 1\n']){
  assert.throws(()=>loadHeaderYaml(source),error=>error instanceof HeaderError&&error.rule==='R12');
 }
 assert.equal(loadHeaderYaml('text: |\n  ---\n  %YAML 1.2\n').metadata.text,'---\n%YAML 1.2\n');
});
