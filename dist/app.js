import {STAGE_NAMES} from './lib/protocol.js';
import {buildCases} from './lib/cases.js';
import {createRoomState,applyPage,querySince,markOk,markError,coverage,allRecords,PAGE_LIMIT} from './lib/store.js';
const SOURCES=['credence','kibble'];
const rooms=SOURCES.map(createRoomState);
const STATUS_LABEL={'all-stages':'ALL 4 STAGES','partial':'PARTIAL','no-request':'REQUEST NOT SEEN'};
const MAX_NODES=7;
let cases=[],selected=null,filter='all',busy=false;
const $=s=>document.querySelector(s);

function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
function formatDuration(ms){if(ms===null||!Number.isFinite(ms))return 'Unavailable';if(ms<0)return 'Invalid ordering';const s=Math.round(ms/1000);if(s<60)return `${s}s`;const m=Math.floor(s/60);if(m<60)return `${m}m ${s%60}s`;return `${Math.floor(m/60)}h ${m%60}m`}
function shortDid(did){return did.startsWith('did:key:')?`${did.slice(8,18)}…${did.slice(-5)}`:did.slice(0,24)}
function visibleCases(){return cases.filter(c=>filter==='all'||(filter==='negative'?c.negative:c.status===filter))}
function renderSummary(){
  $('#caseCount').textContent=cases.length;$('#completeCount').textContent=cases.filter(c=>c.status==='all-stages').length;$('#disputedCount').textContent=cases.filter(c=>c.negative).length;$('#orphanCount').textContent=cases.filter(c=>c.status==='no-request').length;
}
function renderList(){
  const host=$('#caseList');host.replaceChildren();const visible=visibleCases();
  if(!visible.length){host.append(el('div','loading','No matching cases in the current observation window.'));return}
  for(const item of visible.slice(0,80)){
    const button=el('button',`case${selected?.key===item.key?' active':''}`);button.type='button';
    const top=el('div','case-top'),badges=el('span','badges');if(item.negative)badges.append(el('span','badge negative',`NEGATIVE ×${item.verdicts.not}`));badges.append(el('span',`badge ${item.status}`,STATUS_LABEL[item.status]));
    top.append(el('span','case-id',item.id),badges);
    const title=el('div','case-title',item.title);const stages=el('div','stages');for(const stage of item.stages)stages.append(el('i',stage.length?'on':''));
    const meta=el('div','case-meta');meta.append(el('span','',`${item.list.length} ${item.list.length===1?'record':'records'}`),el('span','',item.room));button.append(top,title,stages,meta);
    button.onclick=()=>{selected=item;renderList();renderInspector();drawGraph()};host.append(button);
  }
  if(visible.length>80)host.append(el('div','loading',`Showing 80 of ${visible.length} cases.`));
}
function finding(host,label,value,detail,tone=''){
  const box=el('div',`finding ${tone}`),head=el('div','finding-head');head.append(el('b','',label),el('span','',value));box.append(head,el('p','',detail));host.append(box);
}
function recordDisclosure(record,flagged){const d=el('details','record'),s=el('summary','',`${record.kind} · ${record.room} #${record.seq}${flagged?' · ⚑':''}`),p=el('p','',record.text),source=el('div','source',`${record.signed?'DID + SIGNATURE FIELDS PRESENT (NOT VERIFIED HERE)':'SELF-ASSERTED SOURCE'} · ${shortDid(record.source)} · ${record.ts}`);d.append(s,p,source);return d}
function renderInspector(){
  const host=$('#inspector');host.replaceChildren();host.append(el('div','eyebrow','EVIDENCE PROFILE'));
  if(!selected){host.append(el('h2','',`No case selected`),el('p','','Select a case to see which records were observed, what is missing, and what cannot be known from them.'));return}
  const c=selected;host.append(el('h2','',c.id),el('p','',`${c.room} · ${c.title}`));
  const present=c.stages.filter(s=>s.length).length;
  finding(host,'Stages observed',`${present} of 4`,STAGE_NAMES.map((name,i)=>`${c.stages[i].length?'✓':'—'} ${name}`).join('  ·  ')+(present<4?'\nA missing stage may simply be outside the observation window.':''));
  const cont={'observed':['Observed','A key that accepted or claimed also posted a result.'],'not-observed':['Not observed','No result was posted by a key that accepted or claimed.'],'no-worker':['Unavailable','No accept or claim in the window.'],'no-result':['Unavailable','No result in the window.']}[c.continuity];
  finding(host,'Key continuity (worker → result)',cont[0],`${cont[1]} Keys are not people; this says nothing about real-world identity.`);
  const a=c.attestation,av={'no-attestation':['None observed','No attestation in the window.'],'no-result':['Unavailable','Attestations are present, but no result is in the window to compare keys against.'],'ok':[`${a.other} other-key · ${a.self} result-key`,'Counts attestations by whether their key also posted a result. Different keys are not proof of independent parties.']}[a.state];
  finding(host,'Attestation keys',av[0],av[1]);
  const v=c.verdicts;if(c.attestation.state!=='no-attestation')finding(host,'Recorded verdicts',`useful ${v.useful} · negative ${v.not}${v.other?` · other ${v.other}`:''}`,v.not?'At least one attestation carries an explicit negative verdict. Read its text below; it is a claim by that key, not a finding.':'Verdicts are claims made by the posting keys.',v.not?'alert':'');
  finding(host,'Request → result timing',c.elapsedFirst===null?'Unavailable':`first ${formatDuration(c.elapsedFirst)}${c.elapsedLast!==c.elapsedFirst?` · last ${formatDuration(c.elapsedLast)}`:''}`,'From venue timestamps, which are not signed by the sender. The first result is not necessarily the substantive one.');
  if(c.flags.length){host.append(el('div','eyebrow','PATTERNS IN THE VISIBLE RECORDS'));for(const f of c.flags)finding(host,f.label,`${f.seqs.length} ${f.seqs.length===1?'record':'records'}`,`${f.detail} Seq ${f.seqs.slice(0,6).map(s=>'#'+s).join(', ')}${f.seqs.length>6?'…':''}. A pattern, not a verdict.`)}
  finding(host,'Cannot be known from these records','','Whether the work was correct or useful, whether different keys are different parties, whether signatures are valid, what caused what, or whether anything was paid.');
  const flagged=new Set(c.flags.flatMap(f=>f.seqs));
  host.append(el('div','eyebrow','SOURCE RECORDS'));for(const record of c.list)host.append(recordDisclosure(record,flagged.has(record.seq)));
}
function render(){cases=buildCases(allRecords(rooms));renderSummary();const visible=visibleCases();selected=(selected&&visible.find(c=>c.key===selected.key))||visible.find(c=>c.status==='all-stages')||visible[0]||null;renderList();renderInspector();drawGraph()}
function fmtSpan(ms){if(ms===null)return 'no data';const s=Math.round(ms/1000);if(s<90)return `${s}s`;const m=Math.round(s/60);if(m<120)return `${m}m`;const h=Math.round(m/60);return h<48?`${h}h`:`${Math.round(h/24)}d`}
function coverageLine(c){const bits=[`${c.room} ${c.records} rec`,fmtSpan(c.spanMs)];if(c.status==='error')bits.push('delayed');if(c.gaps)bits.push(`${c.missed} missed`);if(c.resets)bits.push(`${c.resets} reset`);if(c.malformed)bits.push(`${c.malformed} unparsed`);return bits.join(' · ')}
async function pollRoom(state){
  const params=new URLSearchParams({format:'json',limit:String(PAGE_LIMIT)});const since=querySince(state);if(since!==null)params.set('since',String(since));
  const response=await fetch(`https://technocore.chat/r/${state.room}?${params}`,{cache:'no-store'});if(!response.ok)throw new Error(`${state.room} returned ${response.status}`);
  applyPage(state,await response.json(),{since});markOk(state,Date.now());
}
async function refresh(){if(busy)return;busy=true;$('#live').className='live';$('#live span').textContent='READING LIVE RECORDS';
  const results=await Promise.allSettled(rooms.map(pollRoom));results.forEach((r,i)=>{if(r.status==='rejected')markError(rooms[i],r.reason?.message||r.reason,Date.now())});
  try{render()}finally{busy=false}
  const cov=rooms.map(coverage),bad=cov.filter(c=>c.status==='error'),total=cov.reduce((n,c)=>n+c.records,0),gaps=cov.reduce((n,c)=>n+c.gaps,0);
  $('#live').className=`live ${bad.length===cov.length?'error':bad.length||gaps?'warn':'ready'}`;
  $('#live span').textContent=bad.length===cov.length?'LIVE READ DELAYED':bad.length?`PARTIAL · ${bad.map(c=>c.room.toUpperCase()).join(', ')} DELAYED`:`LIVE · ${total} PROTOCOL RECORDS${gaps?' · GAPS':''}`;
  $('#sourceStatus').textContent=cov.map(coverageLine).join('  |  ');$('#sourceStatus').title=bad.map(c=>c.error).join('\n');
}

const canvas=$('#graph'),ctx=canvas.getContext('2d');
function resizeCanvas(){const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio,2);canvas.width=rect.width*scale;canvas.height=rect.height*scale;ctx.setTransform(scale,0,0,scale,0,0);drawGraph()}
// The graph is static: it is redrawn only when the selection or data changes. Columns are stages, not relationships.
function drawGraph(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);if(!selected){$('#emptyGraph').style.display='block';return}$('#emptyGraph').style.display='none';$('#graphTitle').textContent=`${selected.id} · ${STATUS_LABEL[selected.status]}`;
  const margin=Math.max(70,w*.1),xs=[margin,w*.36,w*.64,w-margin],centerY=h*.54,nodeColors=['#d7ff55','#65bfff','#ffbe5c','#67e8a5'],pos=new Map();
  ctx.textAlign='center';ctx.font='10px DM Mono';for(let i=0;i<4;i++){ctx.fillStyle='#8696a8';ctx.fillText(STAGE_NAMES[i],xs[i],112)}
  selected.stages.forEach((items,stage)=>{const shown=items.slice(0,MAX_NODES);shown.forEach((record,index)=>pos.set(record.seq,{x:xs[stage],y:centerY+(index-(shown.length-1)/2)*55,stage,record}));
    if(items.length>MAX_NODES){ctx.fillStyle='#8696a8';ctx.font='10px DM Mono';ctx.fillText(`+${items.length-MAX_NODES} more · see records`,xs[stage],centerY+(MAX_NODES/2+.4)*55)}});
  for(const link of selected.links){let a=pos.get(link.from),b=pos.get(link.to);if(!a||!b||a.x===b.x)continue;if(a.x>b.x)[a,b]=[b,a];
    ctx.strokeStyle=link.type==='cites'?'#9fb2c8':'#4b5d72';ctx.lineWidth=link.type==='cites'?1.6:1;ctx.setLineDash(link.type==='cites'?[]:[4,4]);ctx.beginPath();ctx.moveTo(a.x+14,a.y);ctx.bezierCurveTo((a.x+b.x)/2,a.y,(a.x+b.x)/2,b.y,b.x-14,b.y);ctx.stroke();ctx.setLineDash([])}
  for(const {x,y,stage,record} of pos.values()){ctx.fillStyle='#0a0e13';ctx.strokeStyle=nodeColors[stage];ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,stage===0?16:13,0,Math.PI*2);ctx.fill();ctx.stroke();
    const r=stage===0?16:13;ctx.font='9px DM Mono';ctx.fillStyle='#cbd5e1';ctx.fillText(record.kind,x,y+r+11);ctx.fillStyle='#8696a8';ctx.fillText(`#${record.seq}`,x,y+r+21)}
  const missing=STAGE_NAMES.filter((_,i)=>!selected.stages[i].length);ctx.font='10px DM Mono';ctx.fillStyle='#8696a8';
  if(missing.length)ctx.fillText(`NOT IN OBSERVED WINDOW: ${missing.join(' · ')}`,w/2,h-46);
  ctx.fillText('Solid line: record cites another by seq  ·  Dashed: same key continues  ·  Columns are stages, not relationships',w/2,h-24);
}
$('#refresh').onclick=()=>refresh();$('#filter').onchange=e=>{filter=e.target.value;render()};addEventListener('resize',resizeCanvas);resizeCanvas();refresh();setInterval(refresh,15000);
if(document.modelContext?.registerTool)document.modelContext.registerTool({name:'inspect_evidence_cases',title:'Inspect evidence cases',description:'Return structural observations for live Technocore work chains already loaded in Proofline.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','all-stages','partial','no-request','negative']}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:({status='all'}={})=>({observed_at:new Date().toISOString(),cases:cases.filter(c=>status==='all'||(status==='negative'?c.negative:c.status===status)).slice(0,20).map(c=>({room:c.room,id:c.id,status:c.status,stages:c.stages.map(s=>s.length),verdicts:c.verdicts,flags:c.flags.map(f=>f.id),records:c.list.length}))})});
