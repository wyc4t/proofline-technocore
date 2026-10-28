// One-time checkpoint bootstrap for legacy state. Reads verified archive bytes only.
import fs from 'node:fs';import {join} from 'node:path';import {parseArgs} from 'node:util';import {gunzipSync} from 'node:zlib';
import {sha256,splitExport} from './lib/records.mjs';import {storageEpoch,legacyAmbiguousGenerations} from '../src/lib/archive-epoch.js';import {validate} from '../api/asset.js';
export function checkpointCapture({data,room,prev}){
 if(prev?.last_seq==null||prev.last_record_sha256)return null;
 const file=join(data,'captures.jsonl');if(!fs.existsSync(file))throw Error('Archived checkpoint is unavailable; recover cursor state before collection');
 const captures=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
 if(legacyAmbiguousGenerations(captures,room).includes(String(prev.generation??'unknown')))throw Error('Legacy sequence reuse requires archive recovery');
 const c=captures.findLast(c=>c.ok&&c.room===room&&String(c.generation??'unknown')===String(prev.generation??'unknown')&&storageEpoch(c)===storageEpoch(prev)&&c.new_records&&c.new_first_seq<=prev.last_seq&&c.new_last_seq>=prev.last_seq);
 if(!c)throw Error('Archived checkpoint is unavailable; recover cursor state before collection');return c;
}
export function bootstrapCheckpoint({data,assets,room,prev}){
 const c=checkpointCapture({data,room,prev});if(!c)return prev;let lines;
 if(c.storage?.kind==='release'){
  const s=c.storage;if(validate(s.tag,s.asset))throw Error('Invalid checkpoint release reference');
  const file=[assets&&join(assets,s.asset),assets&&join(assets,s.tag,s.asset),join(data,'pending-uploads',s.tag,s.asset)].filter(Boolean).find(p=>fs.existsSync(p));
  if(!file)throw Error('Checkpoint release bytes unavailable; supply --checkpoint-assets');const gz=fs.readFileSync(file);if(sha256(gz)!==s.gz_sha256||s.gz_bytes!=null&&gz.length!==s.gz_bytes)throw Error('Checkpoint gzip does not match manifest');lines=splitExport(gunzipSync(gz)).parsed;
 }else if(c.storage?.kind==='git')lines=(c.storage.files||[]).flatMap(p=>splitExport(fs.readFileSync(join(data,p))).parsed).filter(p=>p.rec.seq>=c.new_first_seq&&p.rec.seq<=c.new_last_seq).sort((a,b)=>a.rec.seq-b.rec.seq);else throw Error('Checkpoint storage is unavailable');
 const bytes=Buffer.concat(lines.flatMap(p=>[p.raw,Buffer.from('\n')]));if(lines.length!==c.new_records||sha256(bytes)!==c.new_sha256)throw Error('Checkpoint capture bytes do not match manifest');const found=lines.filter(p=>p.rec.seq===prev.last_seq);if(found.length!==1)throw Error('Checkpoint sequence is not unique');
 return {...prev,storage_epoch:storageEpoch(prev),last_record_sha256:sha256(found[0].raw)};
}
if(import.meta.url===`file://${process.argv[1]}`){const {values:v}=parseArgs({options:{data:{type:'string'},'list-assets':{type:'boolean'}}});if(!v.data||!v['list-assets'])throw Error('Usage: bootstrap.mjs --data <archive> --list-assets');const p=join(v.data,'state.json');if(fs.existsSync(p))for(const [room,prev] of Object.entries(JSON.parse(fs.readFileSync(p)).rooms||{})){try{const c=checkpointCapture({data:v.data,room,prev});if(c?.storage?.kind==='release'){const s=c.storage;if(validate(s.tag,s.asset))throw Error('Invalid checkpoint release reference');console.log(`${s.tag}\t${s.asset}`)}}catch(error){console.error(`${room}: checkpoint bootstrap unavailable: ${error.message}`)}}}
