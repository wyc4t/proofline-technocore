import {loadPinned} from './lib/snapshot.js';
import {parseRoomPage,checkSignature} from './lib/signature.js';
const $=s=>document.querySelector(s);
const MAINTAINER={did:'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh',room:'d-proofline',seq:1};
// Check the live signature first. If the statement is absent or does not verify, try the
// archived copy, checked against its manifest hash and independently signature-verified.
const isStatement=m=>m&&Number(m.seq)===MAINTAINER.seq&&m.from===MAINTAINER.did&&/maintain Proofline/.test(String(m.text));
async function archivedStatement(){
  const fetchText=async u=>{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return r.text()};
  const fetchBytes=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(String(r.status));return new Uint8Array(await r.arrayBuffer())};
  const res=await loadPinned({room:MAINTAINER.room,gen:'1',from:MAINTAINER.seq,to:MAINTAINER.seq,fetchText,fetchBytes,assetUrl:()=>''});
  const dec=new TextDecoder();return res.lines.map(l=>parseRoomPage(dec.decode(l))).find(isStatement)||null;
}
async function checkMaintainer(){
  const out=$('#maintainerProof');if(!out)return;
  const show=(text,tone)=>{out.textContent=text;out.className=`proof ${tone}`};
  let m=null,live=true;
  try{
    const res=await fetch(`https://technocore.chat/r/${MAINTAINER.room}/export`,{cache:'no-store'});
    if(res.ok){const line=(await res.text()).split('\n').find(l=>/^\{"seq":1,/.test(l));m=line?parseRoomPage(line):null}
  }catch{}
  let st=isStatement(m)?await checkSignature(MAINTAINER.room,m):null;
  if(!isStatement(m)||!['valid','unchecked'].includes(st)){
    live=false;try{m=await archivedStatement()}catch{m=null}
    st=isStatement(m)?await checkSignature(MAINTAINER.room,m):null;
  }
  if(!isStatement(m)){show('no verifiable maintainer statement is available from the room or evidence archive right now.','warn');return}
  const where=live?`${MAINTAINER.room} #${MAINTAINER.seq}, ${String(m.ts).slice(0,10)}`:`archived copy of ${MAINTAINER.room} #${MAINTAINER.seq}, ${String(m.ts).slice(0,10)}`;
  if(st==='valid')show(`signature verified (${where}).`,'ok');
  else if(st==='unchecked')show('your browser cannot check this signature.','warn');
  else show('the signature does not verify.','bad');
}
checkMaintainer();
if(location.hash){const target=document.getElementById(location.hash.slice(1));if(target?.tagName==='DETAILS')target.open=true}
