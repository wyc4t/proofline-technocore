#!/usr/bin/env node
// Offline release rehearsal. No fetch, GitHub, deployment, or source-archive writes.
import fs from 'node:fs';
import {join,resolve,basename,sep} from 'node:path';
import {parseArgs} from 'node:util';
import {check} from './check.mjs';
import {sha256} from './lib/records.mjs';
import {computeStats,STATS_VERSION} from './stats.mjs';
import {dayWindow,summarizeDayRoom} from './daily.mjs';
import {rebuildLookup} from './lookup.mjs';
import {validate as validateAsset,REPO} from '../api/asset.js';
const codeRoot=new URL('../',import.meta.url);
const readJSON=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const writeJSON=(p,value)=>{fs.mkdirSync(join(p,'..'),{recursive:true});fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n')};
function filesBelow(dir){
 if(!dir||!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesBelow(join(dir,e.name)):e.isFile()?[join(dir,e.name)]:[]);
}
function datesBetween(first,last){
 const a=dayWindow(first),b=dayWindow(last);if(a.fromMs>b.fromMs)throw Error('Backfill start must not follow its end');
 if((b.toMs-a.fromMs)/86400e3>366)throw Error('Choose a backfill batch of at most 366 UTC days');
 const days=[];for(let t=a.fromMs;t<b.toMs;t+=86400e3)days.push(new Date(t).toISOString().slice(0,10));return days;
}
export function releasePlan({data,assets,fromDay,throughDay,rooms=['kibble','credence'],now=Date.now(),maxAgeHours=2}){
 if(!rooms.length||rooms.some(r=>!['kibble','credence'].includes(r)))throw Error('Release rooms must be kibble and/or credence');
 if(!Number.isFinite(now)||!Number.isFinite(maxAgeHours)||maxAgeHours<=0)throw Error('Invalid rehearsal time or snapshot age');
 const capturesPath=join(data,'captures.jsonl'),capturesText=fs.readFileSync(capturesPath,'utf8');
 const captures=capturesText.split('\n').filter(s=>s.trim()).map(JSON.parse),selected=captures.filter(c=>c.ok&&rooms.includes(c.room));
 if(!selected.length)throw Error('No successful captures for the selected rooms');
 const times=selected.map(c=>Date.parse(c.captured_at));if(times.some(t=>!Number.isFinite(t)))throw Error('Invalid capture timestamps');
 const first=times.reduce((a,b)=>Math.min(a,b),Infinity),last=times.reduce((a,b)=>Math.max(a,b),-Infinity);
 const days=datesBetween(fromDay||new Date(first).toISOString().slice(0,10),throughDay||new Date(last-86400e3).toISOString().slice(0,10));
 if(dayWindow(days.at(-1)).toMs>dayWindow(new Date(now).toISOString().slice(0,10)).fromMs)throw Error('Backfill must end before the current UTC day');
 const report=check({data,assets});
 const paths=new Map();for(const p of filesBelow(assets)){const name=basename(p);paths.set(name,[...(paths.get(name)||[]),p])}
 const refs=new Map();for(const c of selected)if(c.storage?.kind==='release')refs.set(`${c.storage.tag}/${c.storage.asset}`,c.storage);
 const inventory=[...refs.values()].map(s=>{
   const problem=validateAsset(s.tag,s.asset),found=paths.get(s.asset)||[];
   let status=problem?'invalid-reference':found.length>1?'ambiguous-file':!found.length?'missing':sha256(fs.readFileSync(found[0]))===s.gz_sha256?'verified':'hash-mismatch';
   return {tag:s.tag,asset:s.asset,expected_bytes:s.gz_bytes??null,expected_sha256:s.gz_sha256,status,url:problem?null:`https://github.com/${REPO}/releases/download/${s.tag}/${s.asset}`};
 });
 const blockers=[...report.problems.map(p=>'Archive integrity: '+p)],roomStatus={};
 for(const room of rooms){const rs=selected.filter(c=>c.room===room);if(!rs.length){blockers.push(`No successful captures for ${room}`);continue}
   const end=rs.reduce((n,c)=>Math.max(n,Date.parse(c.captured_at)),-Infinity),age=(now-end)/3600e3;
   roomStatus[room]={last_capture:new Date(end).toISOString(),snapshot_age_hours:Math.round(age*100)/100};
   if(age>maxAgeHours)blockers.push(`${room} snapshot is older than ${maxAgeHours} hours`);
   if(age<0)blockers.push(`${room} snapshot has a future capture timestamp`);
 }
 const unavailable=inventory.filter(a=>a.status!=='verified');
 if(unavailable.length)blockers.push(`${unavailable.length} required release assets are not verified locally`);
 const warnings=[];
 for(const [room,gens] of Object.entries(report.rooms))if(rooms.includes(room))for(const [gen,g] of Object.entries(gens)){
   if(g.known_gaps.length||g.unknown.not_available_to_this_check.length)warnings.push({room,generation:gen,known_gaps:g.known_gaps.length,unavailable_captures:g.unknown.not_available_to_this_check.length});
 }
 const code={};for(const p of ['archive/release.mjs','archive/stats.mjs','archive/daily.mjs','archive/lookup.mjs','archive/lib/lookup.mjs','src/lib/cases.js','src/lib/population.js','src/lib/protocol.js'])code[p]=sha256(fs.readFileSync(new URL(p,codeRoot)));
 return {format:'proofline-release-plan',version:1,generated_at:new Date(now).toISOString(),mode:'offline-plan-only',stats_version:STATS_VERSION,
   source:{data:resolve(data),assets:assets?resolve(assets):null,captures_sha256:sha256(capturesText),daily_index_sha256:fs.existsSync(join(data,'stats/daily/index.json'))?sha256(fs.readFileSync(join(data,'stats/daily/index.json'))):null,first_capture:new Date(first).toISOString(),last_capture:new Date(last).toISOString(),rooms:roomStatus},
   selection:{rooms,days,rolling_hours:24,max_snapshot_age_hours:maxAgeHours},code,inventory,
   totals:{release_assets:inventory.length,verified_assets:inventory.filter(a=>a.status==='verified').length,unavailable_assets:unavailable.length,declared_release_bytes:inventory.reduce((n,a)=>n+(a.expected_bytes||0),0),unavailable_declared_bytes:unavailable.reduce((n,a)=>n+(a.expected_bytes||0),0)},
   blockers,warnings,can_prepare_local_data:blockers.length===0,publication_authorized:false,
   boundaries:'Planning does not download assets, change source data, publish an index, recompute published statistics or deploy. Output requires review and separate approval.'};
}
function assertOutsideSource(out,data,assets){
 for(const root of [data,assets].filter(Boolean)){const r=resolve(root);if(out===r||out.startsWith(r+sep))throw Error('Release output must be outside source archive and asset directories')}
}
export function prepareReleaseData(options){
 if(!options.out)throw Error('Choose a fresh release output directory');const out=resolve(options.out);
 assertOutsideSource(out,options.data,options.assets);
 if(fs.existsSync(out))throw Error('Choose a fresh release output directory');
 const plan=releasePlan(options);if(!plan.can_prepare_local_data)throw Error('Release rehearsal blocked: '+plan.blockers.join('; '));
 fs.mkdirSync(out);
 writeJSON(join(out,'plan.json'),plan);
 rebuildLookup({data:options.data,assets:options.assets,out:join(out,'lookup'),now:plan.generated_at});
 const latest=computeStats({data:options.data,assets:options.assets,rooms:plan.selection.rooms,now:Date.parse(plan.generated_at),hours:24});
 writeJSON(join(out,'stats/latest.json'),latest);
 const days=[];
 for(const day of plan.selection.days){const s=computeStats({data:options.data,assets:options.assets,rooms:plan.selection.rooms,now:Date.parse(plan.generated_at),window:dayWindow(day)});
   writeJSON(join(out,`stats/daily/${day}.json`),{...s,day});
   days.push({day,generated_at:s.generated_at,stats_version:s.stats_version,rooms:Object.fromEntries(Object.entries(s.rooms).map(([r,v])=>[r,summarizeDayRoom(v)]))});
 }
 const priorPath=join(options.data,'stats/daily/index.json'),prior=fs.existsSync(priorPath)?readJSON(priorPath):{format:'proofline-daily',days:[]};
 if(prior.format!=='proofline-daily'||!Array.isArray(prior.days))throw Error('Invalid existing daily index; refusing to replace history');
 const selected=new Set(plan.selection.days),preserved=prior.days.filter(d=>!selected.has(d.day));
 writeJSON(join(out,'stats/daily/index.json'),{...prior,days:[...preserved,...days].sort((a,b)=>b.day.localeCompare(a.day))});
 const outputs=filesBelow(out).sort().map(p=>({path:p.slice(resolve(out).length+1),sha256:sha256(fs.readFileSync(p)),bytes:fs.statSync(p).size}));
 const sourceAfter=sha256(fs.readFileSync(join(options.data,'captures.jsonl')));
 const indexAfter=fs.existsSync(priorPath)?sha256(fs.readFileSync(priorPath)):null;
 if(indexAfter!==plan.source.daily_index_sha256)throw Error('Source daily index changed during rehearsal; discard these outputs and retry');
 if(sourceAfter!==plan.source.captures_sha256)throw Error('Source capture log changed during rehearsal; discard these outputs and retry');
 const summary={format:'proofline-release-rehearsal',version:1,generated_at:plan.generated_at,source:plan.source,selection:plan.selection,stats_version:STATS_VERSION,outputs,publication_authorized:false,
   warnings:plan.warnings,note:'Generated local candidates only. Unselected daily-index entries are preserved; source daily files outside the selected batch remain unchanged.'};
 writeJSON(join(out,'summary.json'),summary);return summary;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const {values:v}=parseArgs({options:{data:{type:'string'},assets:{type:'string'},from:{type:'string'},through:{type:'string'},rooms:{type:'string',default:'kibble,credence'},out:{type:'string'},prepare:{type:'boolean'},'max-age-hours':{type:'string',default:'2'}}});
 if(!v.data||!v.out)throw Error('Usage: node archive/release.mjs --data <archive> [--assets <dir>] [--from YYYY-MM-DD --through YYYY-MM-DD] --out <NEW plan file or directory> [--prepare]');
 const opts={data:v.data,assets:v.assets,fromDay:v.from,throughDay:v.through,rooms:v.rooms.split(','),maxAgeHours:Number(v['max-age-hours'])};
 if(v.prepare)console.log(JSON.stringify(prepareReleaseData({...opts,out:resolve(v.out)})));
 else{assertOutsideSource(resolve(v.out),v.data,v.assets);if(fs.existsSync(v.out))throw Error('Plan output already exists');const plan=releasePlan(opts);fs.writeFileSync(v.out,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({can_prepare_local_data:plan.can_prepare_local_data,totals:plan.totals,blockers:plan.blockers}));}
}
