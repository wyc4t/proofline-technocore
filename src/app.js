import {STAGE_NAMES} from './lib/protocol.js';
import {buildCases} from './lib/cases.js';
import {parseRoomPage,annotateSignatures,signatureSupport,checkSignature} from './lib/signature.js';
import {createRoomState,applyPage,querySince,markOk,markError,coverage,allRecords,PAGE_LIMIT} from './lib/store.js';
const SOURCES=['credence','kibble'];
const rooms=SOURCES.map(createRoomState);
const SIG_LABEL={valid:'SIGNATURE VERIFIED',invalid:'SIGNATURE DOES NOT VERIFY',no_sig:'KEY NAMED, NO SIGNATURE · NOT RE-VERIFIABLE',unsigned:'NOT A KEY · SELF-ASSERTED NAME',unchecked:'SIGNATURE NOT CHECKED IN THIS BROWSER'};
const STATUS_LABEL={'all-stages':'ALL 4 STAGES','partial':'PARTIAL','no-request':'REQUEST NOT SEEN'};
const MAX_NODES=7,FETCH_TIMEOUT_MS=10000,LIST_STEP=80;
let cases=[],selected=null,filter='all',busy=false,paused=false,frozenAt=0,lastInspKey=null,listLimit=LIST_STEP,detailOpener=null;
const uiSig={list:'',insp:''};
const isNarrow=()=>matchMedia('(max-width:650px)').matches;
const protocolTotal=()=>rooms.reduce((n,r)=>n+r.counts.protocol,0);
const $=s=>document.querySelector(s);

function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
function formatDuration(ms){if(ms===null||!Number.isFinite(ms))return 'Unavailable';if(ms<0)return 'Invalid ordering';const s=Math.round(ms/1000);if(s<60)return `${s}s`;const m=Math.floor(s/60);if(m<60)return `${m}m ${s%60}s`;return `${Math.floor(m/60)}h ${m%60}m`}
function shortDid(did){if(!did)return 'unknown sender';return did.startsWith('did:key:')?`${did.slice(8,18)}…${did.slice(-5)}`:did.slice(0,24)}
const clock=ms=>ms?new Date(ms).toLocaleTimeString([],{hour12:false}):'never';
function visibleCases(){return cases.filter(c=>filter==='all'||(filter==='negative'?c.negative:c.status===filter))}
function renderSummary(){
  $('#caseCount').textContent=cases.length;$('#completeCount').textContent=cases.filter(c=>c.status==='all-stages').length;$('#disputedCount').textContent=cases.filter(c=>c.negative).length;$('#orphanCount').textContent=cases.filter(c=>c.status==='no-request').length;
}
function renderList(){
  const host=$('#caseList');host.replaceChildren();const visible=visibleCases();
  if(!visible.length){host.append(el('div','loading','No matching cases in the current observation window.'));return}
  for(const item of visible.slice(0,listLimit)){
    const button=el('button',`case${selected?.key===item.key?' active':''}`);button.type='button';button.dataset.key=item.key;if(selected?.key===item.key)button.setAttribute('aria-current','true');
    const top=el('div','case-top'),badges=el('span','badges');if(item.negative)badges.append(el('span','badge negative',`NEGATIVE ×${item.verdicts.not}`));badges.append(el('span',`badge ${item.status}`,STATUS_LABEL[item.status]));
    top.append(el('span','case-id',item.id),badges);
    const title=el('div','case-title',item.title);const stages=el('div','stages');const seen=item.stages.filter(x=>x.length).length;stages.setAttribute('role','img');stages.setAttribute('aria-label',`${seen} of 4 stages seen: ${STAGE_NAMES.filter((_,i)=>item.stages[i].length).join(', ')||'none'}`);for(const stage of item.stages)stages.append(el('i',stage.length?'on':''));
    const meta=el('div','case-meta');meta.append(el('span','',`${seen}/4 stages · ${item.list.length} ${item.list.length===1?'record':'records'}`),el('span','',item.room));button.append(top,title,stages,meta);
    button.onclick=()=>choose(item);host.append(button);
  }
  if(visible.length>listLimit){const more=el('button','more',`Showing ${listLimit} of ${visible.length} cases · show ${Math.min(LIST_STEP,visible.length-listLimit)} more`);more.type='button';more.onclick=()=>{listLimit+=LIST_STEP;render(true)};host.append(more)}
}
function finding(host,label,value,detail,tone=''){
  const box=el('div',`finding ${tone}`),head=el('div','finding-head');head.append(el('b','',label),el('span','',value));box.append(head,el('p','',detail));host.append(box);
}
function recordDisclosure(record,flagged){const d=el('details','record'),s=el('summary','',`${record.kind} · ${record.room} #${record.seq}${flagged?' · ⚑':''}`),p=el('p','',record.text),source=el('div',`source sig-${record.sigStatus}`,`${SIG_LABEL[record.sigStatus]} · ${shortDid(record.source)} · ${record.ts}`);d.dataset.seq=String(record.seq);s.dataset.seq=String(record.seq);d.append(s,p,source);return d}
function renderInspector(){
  const host=$('#inspector');host.replaceChildren();const back=el('button','back','← All cases');back.type='button';back.onclick=closeDetail;host.append(back,el('div','eyebrow','EVIDENCE PROFILE'));
  if(!selected){host.append(el('h2','',`No case selected`),el('p','','Select a case to see which records were observed, what is missing, and what cannot be known from them.'));return}
  const c=selected;host.append(el('h2','',c.id),el('p','',`${c.room} · ${c.title}`));
  const present=c.stages.filter(s=>s.length).length;
  finding(host,'Stages observed',`${present} of 4`,STAGE_NAMES.map((name,i)=>`${c.stages[i].length?'✓':'—'} ${name}`).join('  ·  ')+(present<4?'\nA missing stage may simply be outside the observation window.':''));
  const sc=c.list.reduce((m,r)=>(m[r.sigStatus]=(m[r.sigStatus]||0)+1,m),{});
  finding(host,'Signatures',['valid','invalid','no_sig','unsigned','unchecked'].filter(k=>sc[k]).map(k=>`${sc[k]} ${{valid:'verified',invalid:'fail',no_sig:'no signature',unsigned:'nickname',unchecked:'not checked'}[k]}`).join(' · '),
    sc.invalid?'At least one record names a key but its signature does not verify. That record is not treated as coming from that key.':sc.unchecked&&!sc.valid?'Your browser cannot check these signatures, so no record here is compared as coming from a key.':'A verified signature shows that the key signed this room, nonce and text. It does not show who holds the key or that the work is correct. Sequence numbers and times are added by Technocore and are not signed.',sc.invalid?'alert':'');
  const cont={'observed':['Observed','A key that accepted or claimed also posted a result.'],'not-observed':['Not observed','No result was posted by a key that accepted or claimed.'],'no-worker':['Unavailable','No accept or claim in the window.'],'no-result':['Unavailable','No result in the window.'],'no-key':['Unavailable','The worker or result records do not come from keys with a verified signature, so keys cannot be compared.']}[c.continuity];
  finding(host,'Key continuity (worker → result)',cont[0],`${cont[1]} Keys are not people; this says nothing about real-world identity.`);
  const a=c.attestation,av={'no-attestation':['None observed','No attestation in the window.'],'no-result':['Unavailable','Attestations are present, but no result is in the window to compare keys against.'],'no-key':['Unavailable','The result records do not come from keys with a verified signature, so attestation keys cannot be compared.'],'ok':[`${a.other} other-key · ${a.self} result-key${a.unknown?` · ${a.unknown} unsigned`:''}`,'Counts attestations by whether their key also posted a result. Unsigned senders are not compared. Different keys are not proof of independent parties.']}[a.state];
  finding(host,'Attestation keys',av[0],av[1]);
  const v=c.verdicts;if(c.attestation.state!=='no-attestation')finding(host,'Recorded verdicts',`useful ${v.useful} · negative ${v.not}${v.other?` · other ${v.other}`:''}`,v.not?'At least one attestation carries an explicit negative verdict. Read its text below; it is a claim by that key, not a finding.':'Verdicts are claims made by the posting keys.',v.not?'alert':'');
  finding(host,'Request → result timing',c.elapsedFirst===null?'Unavailable':`first ${formatDuration(c.elapsedFirst)}${c.elapsedLast!==c.elapsedFirst?` · last ${formatDuration(c.elapsedLast)}`:''}`,'From venue timestamps, which are not signed by the sender. The first result is not necessarily the substantive one.');
  if(c.flags.length){host.append(el('div','eyebrow','PATTERNS IN THE VISIBLE RECORDS'));for(const f of c.flags)finding(host,f.label,`${f.seqs.length} ${f.seqs.length===1?'record':'records'}`,`${f.detail} Seq ${f.seqs.slice(0,6).map(s=>'#'+s).join(', ')}${f.seqs.length>6?'…':''}. A pattern, not a verdict.`)}
  finding(host,'Cannot be known from these records','','Whether the work was correct or useful, who holds a key, whether different keys are different parties, what caused what, or whether anything was paid.');
  const flagged=new Set(c.flags.flatMap(f=>f.seqs));
  host.append(el('div','eyebrow','SOURCE RECORDS'));for(const record of c.list)host.append(recordDisclosure(record,flagged.has(record.seq)));
}
function snapshotUi(){const ae=document.activeElement,inList=ae&&ae.closest?.('#caseList'),inInsp=ae&&ae.closest?.('#inspector');
  return {focusKey:inList?ae.dataset.key:null,focusSeq:inInsp?ae.dataset?.seq??null:null,list:$('#caseList').scrollTop,insp:$('#inspector').scrollTop,open:[...document.querySelectorAll('#inspector details[open]')].map(d=>d.dataset.seq)}}
function listSignature(visible){return `${filter}|${selected?.key}|${listLimit}|${visible.length}|`+visible.slice(0,listLimit).map(c=>`${c.key}:${c.fingerprint}`).join('\n')}
function inspectorSignature(){return selected?`${selected.key}|${selected.fingerprint}`:'none'}
// Re-render only what changed, and put back scroll position, open records and keyboard focus. Selecting another case starts fresh.
function render(force=false){
  if(!paused)cases=buildCases(allRecords(rooms));
  renderSummary();const visible=visibleCases();
  selected=(selected&&visible.find(c=>c.key===selected.key))||visible.find(c=>c.status==='all-stages')||visible[0]||null;
  const ls=listSignature(visible),is=inspectorSignature();
  if(force||ls!==uiSig.list||is!==uiSig.insp){
    const ui=snapshotUi(),sameCase=selected?.key===lastInspKey;
    if(force||ls!==uiSig.list){renderList();$('#caseList').scrollTop=ui.list;if(ui.focusKey)$('#caseList').querySelector(`[data-key="${CSS.escape(ui.focusKey)}"]`)?.focus({preventScroll:true})}
    if(force||is!==uiSig.insp){renderInspector();if(!sameCase)$('#inspector').scrollTop=0;if(sameCase){for(const d of document.querySelectorAll('#inspector details'))if(ui.open.includes(d.dataset.seq))d.open=true;$('#inspector').scrollTop=ui.insp;if(ui.focusSeq)$('#inspector').querySelector(`summary[data-seq="${CSS.escape(ui.focusSeq)}"]`)?.focus({preventScroll:true})}}
    uiSig.list=ls;uiSig.insp=is;lastInspKey=selected?.key??null;
  }
  drawGraph();
}
function choose(item){selected=item;if(isNarrow()){detailOpener=document.activeElement;document.body.classList.add('detail');history.pushState({detail:1},'');setDetailInert(true)}render(true);if(isNarrow()){$('#inspector').scrollTop=0;$('#inspector .back')?.focus({preventScroll:true})}}
function setDetailInert(on){for(const sel of ['.cases','header','.summary','footer'])document.querySelector(sel)?.toggleAttribute('inert',on);const i=$('#inspector');if(on){i.setAttribute('role','region');i.setAttribute('aria-label','Case detail')}else{i.removeAttribute('role');i.removeAttribute('aria-label')}}
function exitDetail(){if(!document.body.classList.contains('detail'))return;document.body.classList.remove('detail');setDetailInert(false);const k=selected?.key,target=(k&&$('#caseList').querySelector(`[data-key="${CSS.escape(k)}"]`))||detailOpener;target?.focus?.({preventScroll:true})}
function closeDetail(){if(history.state?.detail)history.back();else exitDetail()}
addEventListener('popstate',exitDetail);
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('detail')&&!document.querySelector('dialog[open]'))closeDetail()});
function fmtSpan(ms){if(ms===null)return 'no data';const s=Math.round(ms/1000);if(s<90)return `${s}s`;const m=Math.round(s/60);if(m<120)return `${m}m`;const h=Math.round(m/60);return h<48?`${h}h`:`${Math.round(h/24)}d`}
function coverageLine(c){const bits=[`${c.room} ${c.records} rec`,fmtSpan(c.spanMs)];if(c.status==='error')bits.push(`delayed · last ok ${clock(c.lastOkAt)}`);if(c.gaps)bits.push(`${c.missed} missed`);if(c.resets)bits.push(`${c.resets} reset`);if(c.malformed+c.unsupported)bits.push(`${c.malformed+c.unsupported} unparsed`);const inv=[...rooms.find(r=>r.room===c.room).records.values()].filter(r=>r.sigStatus==='invalid').length;if(inv)bits.push(`${inv} signature ${inv===1?'fails':'fail'}`);return bits.join(' · ')}
async function pollRoom(state){
  const params=new URLSearchParams({format:'json',limit:String(PAGE_LIMIT)});const since=querySince(state);if(since!==null)params.set('since',String(since));
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),FETCH_TIMEOUT_MS);
  try{
    const response=await fetch(`https://technocore.chat/r/${state.room}?${params}`,{cache:'no-store',signal:ctl.signal});if(!response.ok)throw new Error(`${state.room} returned ${response.status}`);
    const page=parseRoomPage(await response.text());await annotateSignatures(state.room,page?.messages);
    applyPage(state,page,{since});markOk(state,Date.now());
  }catch(error){throw ctl.signal.aborted?new Error(`${state.room} did not answer within ${FETCH_TIMEOUT_MS/1000}s`):error}
  finally{clearTimeout(timer)}
}
function updateStatus(){
  const cov=rooms.map(coverage),bad=cov.filter(c=>c.status==='error'),total=cov.reduce((n,c)=>n+c.records,0),gaps=cov.reduce((n,c)=>n+c.gaps,0);
  $('#live').className=`live ${bad.length===cov.length?'error':bad.length||gaps||paused?'warn':'ready'}`;
  $('#live span').textContent=paused?`PAUSED · ${Math.max(0,protocolTotal()-frozenAt)} NEW`:bad.length===cov.length?'LIVE READ DELAYED':bad.length?`PARTIAL · ${bad.map(c=>c.room.toUpperCase()).join(', ')} DELAYED`:`LIVE · ${total} PROTOCOL RECORDS${gaps?' · GAPS':''} · ${clock(Math.max(...cov.map(c=>c.lastOkAt||0)))}`;
  $('#sourceStatus').textContent=cov.map(coverageLine).join('  |  ')+(signatureSupport()===false?'  |  this browser cannot check signatures, so keys are not compared':'');$('#sourceStatus').title=bad.map(c=>c.error).join('\n');
  const b=$('#pause');b.setAttribute('aria-pressed',String(paused));b.querySelector('.ico').textContent=paused?'▶':'⏸';b.querySelector('.lbl').textContent=paused?`Resume · ${Math.max(0,protocolTotal()-frozenAt)} new`:'Pause updates';b.setAttribute('aria-label',paused?'Resume live updates':'Pause live updates');
}
async function refresh(){if(busy)return;busy=true;if(!paused){$('#live').className='live';$('#live span').textContent='READING LIVE RECORDS'}
  // Each room settles on its own (bounded by the timeout) and is shown as soon as it answers; one stalled room cannot hold back the other.
  try{await Promise.all(rooms.map(async state=>{try{await pollRoom(state)}catch(error){markError(state,error?.message||error,Date.now())}if(!paused)render();updateStatus()}))}finally{busy=false}
  updateStatus();
}
function togglePause(){paused=!paused;if(paused)frozenAt=protocolTotal();else render(true);updateStatus()}

const canvas=$('#graph'),ctx=canvas.getContext('2d');
function resizeCanvas(){const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio,2);canvas.width=rect.width*scale;canvas.height=rect.height*scale;ctx.setTransform(scale,0,0,scale,0,0);drawGraph()}
// The graph is static: it is redrawn only when the selection or data changes. Columns are stages, not relationships.
function drawGraph(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);if(!selected){$('#emptyGraph').style.display='block';return}$('#emptyGraph').style.display='none';$('#graphTitle').textContent=`${selected.id} · ${STATUS_LABEL[selected.status]}`;canvas.setAttribute('aria-label',`Diagram of case ${selected.id}: ${selected.stages.map((x,i)=>`${x.length} ${STAGE_NAMES[i].toLowerCase()}`).join(', ')} records. The same records are listed in the evidence profile.`);
  const margin=Math.max(70,w*.1),xs=[margin,w*.36,w*.64,w-margin],centerY=h*.54,nodeColors=['#d7ff55','#65bfff','#ffbe5c','#67e8a5'],pos=new Map();
  ctx.textAlign='center';ctx.font='10px DM Mono';for(let i=0;i<4;i++){ctx.fillStyle='#8696a8';ctx.fillText(STAGE_NAMES[i],xs[i],112)}
  selected.stages.forEach((items,stage)=>{const shown=items.slice(0,MAX_NODES);shown.forEach((record,index)=>pos.set(record.seq,{x:xs[stage],y:centerY+(index-(shown.length-1)/2)*55,stage,record}));
    if(items.length>MAX_NODES){ctx.fillStyle='#8696a8';ctx.font='10px DM Mono';ctx.fillText(`+${items.length-MAX_NODES} more · see records`,xs[stage],centerY+(MAX_NODES/2+.4)*55)}});
  let hidden=0;
  for(const link of selected.links){const a0=pos.get(link.from),b0=pos.get(link.to);if(!a0||!b0){hidden++;continue}
    ctx.strokeStyle=link.type==='cites'?'#9fb2c8':'#4b5d72';ctx.lineWidth=link.type==='cites'?1.6:1;ctx.setLineDash(link.type==='cites'?[]:[4,4]);ctx.beginPath();
    if(a0.x===b0.x){const bulge=a0.x+16+Math.min(46,Math.abs(a0.y-b0.y)*.35+14);ctx.moveTo(a0.x+13,a0.y);ctx.bezierCurveTo(bulge,a0.y,bulge,b0.y,b0.x+13,b0.y)}
    else{let a=a0,b=b0;if(a.x>b.x)[a,b]=[b,a];ctx.moveTo(a.x+14,a.y);ctx.bezierCurveTo((a.x+b.x)/2,a.y,(a.x+b.x)/2,b.y,b.x-14,b.y)}
    ctx.stroke();ctx.setLineDash([])}
  for(const {x,y,stage,record} of pos.values()){ctx.fillStyle='#0a0e13';ctx.strokeStyle=nodeColors[stage];ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,stage===0?16:13,0,Math.PI*2);ctx.fill();ctx.stroke();
    const r=stage===0?16:13;ctx.font='9px DM Mono';ctx.fillStyle='#cbd5e1';ctx.fillText(record.kind,x,y+r+11);ctx.fillStyle='#8696a8';ctx.fillText(`#${record.seq}`,x,y+r+21)}
  const missing=STAGE_NAMES.filter((_,i)=>!selected.stages[i].length);ctx.font='10px DM Mono';ctx.fillStyle='#8696a8';
  if(missing.length)ctx.fillText(`NOT IN OBSERVED WINDOW: ${missing.join(' · ')}`,w/2,h-46);
  ctx.fillText('Solid line: record names another by seq  ·  Dashed: same key continues  ·  Columns are stages, not relationships',w/2,h-24);
  if(hidden)ctx.fillText(`${hidden} ${hidden===1?'connection involves a record':'connections involve records'} not drawn (see the records list)`,w/2,h-8);
}
// The maintainer's key is fixed here, so a statement signed by any other key can never pass as the maintainer's.
const MAINTAINER={did:'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh',room:'d-proofline',seq:1};
async function checkMaintainer(){
  const out=$('#maintainerProof');if(!out)return;
  const show=(text,tone)=>{out.textContent=text;out.className=`proof ${tone}`};
  try{
    const res=await fetch(`https://technocore.chat/r/${MAINTAINER.room}/export`,{cache:'no-store'});if(!res.ok)throw new Error(String(res.status));
    const line=(await res.text()).split('\n').find(l=>/^\{"seq":1,/.test(l));
    const m=line?parseRoomPage(line):null;
    if(!m||Number(m.seq)!==MAINTAINER.seq||m.from!==MAINTAINER.did||!/maintain Proofline/.test(String(m.text))){show('the statement is not in the room right now, so it cannot be checked.','warn');return}
    const st=await checkSignature(MAINTAINER.room,m);
    if(st==='valid')show(`signature verified (${MAINTAINER.room} #${MAINTAINER.seq}, ${String(m.ts).slice(0,10)}).`,'ok');
    else if(st==='unchecked')show('your browser cannot check this signature.','warn');
    else show('the signature does not verify.','bad');
  }catch{show('the room could not be reached, so the statement was not checked.','warn')}
}
checkMaintainer();
const about=$('#aboutDialog');
function openAbout(){if(typeof about.showModal==='function'&&!about.open)about.showModal()}
$('#about').onclick=openAbout;$('#aboutClose').onclick=()=>about.close();
about.addEventListener('click',e=>{if(e.target===about)about.close()});
about.addEventListener('close',()=>{try{if(location.hash==='#about')history.replaceState(null,'',location.pathname+location.search)}catch{}});
document.addEventListener('click',e=>{if(e.target.closest?.('.about-link')){e.preventDefault();openAbout()}});
if(location.hash==='#about')openAbout();
$('#refresh').onclick=()=>refresh();$('#pause').onclick=togglePause;$('#filter').onchange=e=>{filter=e.target.value;render(true)};addEventListener('resize',resizeCanvas);resizeCanvas();refresh();setInterval(refresh,15000);
if(document.modelContext?.registerTool)document.modelContext.registerTool({name:'inspect_evidence_cases',title:'Inspect evidence cases',description:'Return structural observations for live Technocore work chains already loaded in Proofline.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','all-stages','partial','no-request','negative']}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:({status='all'}={})=>({observed_at:new Date().toISOString(),cases:cases.filter(c=>status==='all'||(status==='negative'?c.negative:c.status===status)).slice(0,20).map(c=>({room:c.room,id:c.id,status:c.status,stages:c.stages.map(s=>s.length),verdicts:c.verdicts,flags:c.flags.map(f=>f.id),records:c.list.length}))})});
