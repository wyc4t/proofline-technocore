import {loadPinned} from './lib/snapshot.js';
import {parseRoomPage,checkSignature} from './lib/signature.js';
const $=s=>document.querySelector(s);
const MAINTAINER={did:'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh',room:'d-proofline-maintainer',archived:{room:'d-proofline',gen:'1',seq:1}};
// Check the live statement in the maintainer's owned room first. If it is absent or does not
// verify, check the original statement (d-proofline #1, 20 October 2026) from the evidence
// archive, against its manifest hash, with its signature verified again. A signature covers its
// room, so a statement copied into another room never verifies there.
const isStatement=m=>m&&m.from===MAINTAINER.did&&/^Proofline maintainer statement:/.test(String(m.text))&&/maintain Proofline/.test(String(m.text));
async function archivedStatement(){
  const fetchText=async u=>{const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(10_000)});if(!r.ok)throw new Error(String(r.status));return r.text()};
  const fetchBytes=async u=>{const r=await fetch(u,{signal:AbortSignal.timeout(10_000)});if(!r.ok)throw new Error(String(r.status));return new Uint8Array(await r.arrayBuffer())};
  const a=MAINTAINER.archived;
  const res=await loadPinned({room:a.room,gen:a.gen,from:a.seq,to:a.seq,fetchText,fetchBytes,assetUrl:()=>''});
  const dec=new TextDecoder();return res.lines.map(l=>parseRoomPage(dec.decode(l))).find(m=>isStatement(m)&&Number(m.seq)===a.seq)||null;
}
async function checkMaintainer(){
  const out=$('#maintainerProof');if(!out)return;
  const show=(text,tone)=>{out.textContent=text;out.className=`proof ${tone}`};
  let m=null,live=true,room=MAINTAINER.room;
  try{
    const res=await fetch(`https://technocore.chat/r/${MAINTAINER.room}/export`,{cache:'no-store',signal:AbortSignal.timeout(10_000)});
    if(res.ok)for(const line of (await res.text()).split('\n')){let c=null;try{c=line.trim()?parseRoomPage(line):null}catch{}if(isStatement(c)){m=c;break}}
  }catch{}
  let st=isStatement(m)?await checkSignature(room,m):null;
  if(!isStatement(m)||!['valid','unchecked'].includes(st)){
    live=false;room=MAINTAINER.archived.room;try{m=await archivedStatement()}catch{m=null}
    st=isStatement(m)?await checkSignature(room,m):null;
  }
  if(!isStatement(m)){show('no verifiable maintainer statement is available from the room or evidence archive right now.','warn');return}
  const where=live?`${room} #${m.seq}, ${String(m.ts).slice(0,10)}`:`archived copy of ${room} #${m.seq}, ${String(m.ts).slice(0,10)}`;
  if(st==='valid')show(`signature verified (${where}).`,'ok');
  else if(st==='unchecked')show('your browser cannot check this signature.','warn');
  else show('the signature does not verify.','bad');
}
checkMaintainer();
if(location.hash){const target=document.getElementById(location.hash.slice(1));if(target?.tagName==='DETAILS')target.open=true}
