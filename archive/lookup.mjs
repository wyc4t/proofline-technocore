#!/usr/bin/env node
// Explicit local rebuild into a NEW destination. No network or publication.
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {check} from './check.mjs';
import {addLookup} from './lib/lookup.mjs';
export function rebuildLookup({data,assets,out,now=new Date().toISOString()}){
  if(existsSync(out))throw Error('Lookup output already exists; choose a fresh destination');
  const report=check({data,assets,keepRecords:true});
  if(report.problems.length)throw Error('Archive integrity problems: '+report.problems.join('; '));
  mkdirSync(out,{recursive:true});
  const available=new Map();
  const lowerBound=(xs,seq)=>{let a=0,b=xs.length;while(a<b){const m=(a+b)>>1;if(xs[m].rec.seq<seq)a=m+1;else b=m}return a};
  for(const line of readFileSync(join(data,'captures.jsonl'),'utf8').split('\n')){
    if(!line.trim())continue;const c=JSON.parse(line);if(!c.ok)continue;
    const key=`${c.room}:${c.generation??'unknown'}`;
    if(!available.has(key))available.set(key,[...(report.records[c.room]?.[`g${c.generation??'unknown'}`]||new Map()).values()].sort((a,b)=>a.rec.seq-b.rec.seq));
    const records=available.get(key),lines=[];
    if(c.new_records)for(let i=lowerBound(records,c.new_first_seq);i<records.length&&records[i].rec.seq<=c.new_last_seq;i++)lines.push(records[i]);
    addLookup(out,c,lines);
  }
  for(const [room,gens] of Object.entries(report.rooms)){
    const path=join(out,room,'status.json');if(!existsSync(path))continue;
    const s=JSON.parse(readFileSync(path,'utf8'));s.rebuilt_at=now;s.unavailable_captures=Object.values(gens).reduce((n,g)=>n+g.unknown.not_available_to_this_check.length,0);s.known_archive_gaps=Object.values(gens).reduce((n,g)=>n+g.known_gaps.length,0);
    writeFileSync(path,JSON.stringify(s)+'\n');
  }
  return {rooms:Object.keys(report.records),scope:'Available archive bytes only; missing release files and historical gaps are not indexed.'};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const {values:v}=parseArgs({options:{data:{type:'string'},assets:{type:'string'},out:{type:'string'}}});
 if(!v.data||!v.out)throw Error('Usage: node archive/lookup.mjs --data <archive> [--assets <dir>] --out <NEW directory>');
 console.log(JSON.stringify(rebuildLookup(v)));
}
