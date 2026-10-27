// Locator index only. Opening a candidate must still load/hash/signature-check the archived evidence.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseMessage} from '../../src/lib/protocol.js';
import {storageEpoch} from '../../src/lib/archive-epoch.js';
export const lookupBucket = id => createHash('sha256').update(id).digest('hex').slice(0,2);
export function addLookup(root, entry, lines) {
  if(!entry.ok)return;
  if(!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(entry.room))throw Error('Invalid lookup room');
  const dir=join(root,entry.room);mkdirSync(dir,{recursive:true});
  const statusPath=join(dir,'status.json');
  const prior=existsSync(statusPath)?JSON.parse(readFileSync(statusPath,'utf8')):null;
  const generation=String(entry.generation??'unknown');
  const storage_epoch=storageEpoch(entry);
  const token=`${entry.captured_at}:${entry.new_sha256}:${generation}:${storage_epoch}`;
  if(prior?.last_token===token)return;
  const reset=entry.events?.some(e=>e.type==='seq_regression'||e.type==='sequence_conflict');
  const epoch=entry.storage_epoch!=null?(storage_epoch===0&&!reset&&prior?.generation===generation&&!prior.storage_epoch?prior.epoch:`${generation}:e${storage_epoch}`):!prior||prior.generation!==generation||reset?`${generation}:${entry.captured_at}`:prior.epoch;
  const gaps=[...(prior?.index_gaps||[])];
  if(prior?.generation===generation&&(prior.storage_epoch??0)===storage_epoch&&!reset&&entry.new_first_seq>prior.last_seq+1)gaps.push({after:prior.last_seq,before:entry.new_first_seq,at:entry.captured_at});
  const reused=[...new Set([...(prior?.reused_generations||[]),...(reset&&entry.storage_epoch==null?[generation]:[])])];
  const version=prior?.version===2||storage_epoch>0||reused.length?2:1;
  const status={...prior,format:'proofline-lookup',version,room:entry.room,first_indexed_capture:prior?.first_indexed_capture||entry.captured_at,last_indexed_capture:entry.captured_at,
    generation,storage_epoch,epoch,last_seq:entry.export_last_seq??(prior?.generation===generation?prior.last_seq:null),last_token:token,
    index_gaps:gaps,reused_generations:reused,unknown_generation:prior?.unknown_generation||!/^\d{1,6}$/.test(generation),
    scope:'Indexed captures only; older/unavailable records may be absent. Candidates are locators, not verified case evidence.'};
  const shards=new Map();
  for(const line of lines){
    const p=parseMessage(line.rec,entry.room);if(!p.ok||!/^\d{1,6}$/.test(generation)||!Number.isSafeInteger(p.record.seq)||p.record.seq<0)continue;
    const r=p.record,b=lookupBucket(r.id),path=join(dir,`${b}.json`);
    if(!shards.has(b))shards.set(b,existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{format:'proofline-lookup-shard',version:1,room:entry.room,entries:[]});
    const shard=shards.get(b);shard.version=Math.max(shard.version,version);
    let e=shard.entries.find(e=>e.id===r.id&&e.epoch===epoch&&(e.storage_epoch??0)===storage_epoch&&r.seq>=e.first&&r.seq-e.first<=5000000);
    if(!e){e={id:r.id,generation,epoch,...(storage_epoch?{storage_epoch}:{}),first:r.seq,last:r.seq,request_seen:false,records:0,first_capture:entry.captured_at,last_capture:entry.captured_at};shard.entries.push(e)}
    e.first=Math.min(e.first,r.seq);e.last=Math.max(e.last,r.seq);e.records++;e.request_seen ||= r.stage===0;e.last_capture=entry.captured_at;
  }
  for(const [b,shard] of shards)writeFileSync(join(dir,`${b}.json`),JSON.stringify(shard)+'\n');
  status.shards=[...new Set([...(prior?.shards||[]),...shards.keys()])].sort();
  writeFileSync(statusPath,JSON.stringify(status)+'\n');
}
