import {STAGE_NAMES} from './lib/protocol.js';
import {buildCases} from './lib/cases.js';
import {createRoomState,applyPage,querySince,markOk,markError,coverage,allRecords,PAGE_LIMIT} from './lib/store.js';
const SOURCES=['credence','kibble'];
const rooms=SOURCES.map(createRoomState);
let cases=[],selected=null,filter='all',busy=false;
const $=s=>document.querySelector(s);
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
function formatDuration(ms){if(ms===null||!Number.isFinite(ms))return 'Unavailable';if(ms<0)return 'Invalid ordering';const seconds=Math.round(ms/1000);return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`}
function shortDid(did){return did.startsWith('did:key:')?`${did.slice(8,18)}…${did.slice(-5)}`:did.slice(0,24)}
function renderSummary(){
  $('#caseCount').textContent=cases.length;$('#completeCount').textContent=cases.filter(c=>c.status==='complete').length;$('#disputedCount').textContent=cases.filter(c=>c.status==='disputed').length;$('#orphanCount').textContent=cases.filter(c=>c.status==='orphan').length;
}
function renderList(){
  const host=$('#caseList');host.replaceChildren();const visible=cases.filter(c=>filter==='all'||c.status===filter);
  if(!visible.length){host.append(el('div','loading','No matching cases in the current observation window.'));return}
  for(const item of visible.slice(0,80)){
    const button=el('button',`case${selected?.key===item.key?' active':''}`);button.type='button';
    const top=el('div','case-top');top.append(el('span','case-id',item.id),el('span',`badge ${item.status}`,item.status.toUpperCase()));
    const title=el('div','case-title',item.title);const stages=el('div','stages');for(const stage of item.stages)stages.append(el('i',stage.length?'on':''));
    const meta=el('div','case-meta');meta.append(el('span','',`${item.list.length} records`),el('span','',item.list[0]?.room||''));button.append(top,title,stages,meta);
    button.onclick=()=>{selected=item;renderList();renderInspector();drawGraph()};host.append(button);
  }
}
function finding(host,label,value,detail,tone=''){
  const box=el('div',`finding ${tone}`),head=el('div','finding-head');head.append(el('b','',label),el('span','',value));box.append(head,el('p','',detail));host.append(box);
}
function recordDisclosure(record){const d=el('details','record'),s=el('summary','',`${record.kind} · ${record.room} #${record.seq}`),p=el('p','',record.text),source=el('div','source',`${record.signed?'DID + SIGNATURE FIELDS PRESENT':'SELF-ASSERTED SOURCE'} · ${shortDid(record.source)} · ${record.ts}`);d.append(s,p,source);return d}
function renderInspector(){
  const host=$('#inspector');host.replaceChildren();host.append(el('div','eyebrow','EVIDENCE PROFILE'));
  if(!selected){host.append(el('h2','',`No case selected`),el('p','','Select a live case to see what is present, what is missing, and which records support the assessment.'));return}
  host.append(el('h2','',selected.id),el('p','',`${selected.room} · ${selected.title}`));
  const present=selected.stages.filter(s=>s.length).length;
  finding(host,'Protocol structure',`${present}/4 stages`,STAGE_NAMES.map((name,i)=>`${selected.stages[i].length?'✓':'—'} ${name}`).join('  ·  '),present===4?'good':'');
  finding(host,'Worker continuity',selected.stages[2].some(r=>selected.workers.has(r.source))?'Observed':'Not observed','Checks whether a DID seen in an accept or claim also appears on a result. This does not establish real-world identity.',selected.stages[2].some(r=>selected.workers.has(r.source))?'good':'alert');
  finding(host,'Independent attestation',selected.independent===null?'Unavailable':selected.independent?'Observed':'Not observed','Checks DID separation between result and attestation records. Independence beyond the keys is unknown.',selected.independent?'good':selected.independent===false?'alert':'');
  if(selected.negative)finding(host,'Explicit dispute','Present','At least one attestation uses an explicit negative verdict. The text below states the recorded reason.','alert');
  finding(host,'Request → result latency',formatDuration(selected.elapsed),'Measured from venue timestamps when both records are present. Venue timestamps are not sender-signed.');
  if(selected.semantic!==null)finding(host,'Lexical alignment signal',`${Math.round(selected.semantic*100)}% overlap`,'A rough shared-term check between request and result. It is a triage hint, not a judgment of semantic correctness.',selected.semantic<.08?'alert':'');
  host.append(el('div','eyebrow','SOURCE RECORDS'));for(const record of selected.list)host.append(recordDisclosure(record));
}
function visibleCases(){return cases.filter(c=>filter==='all'||c.status===filter)}
function render(){cases=buildCases(allRecords(rooms));renderSummary();const visible=visibleCases();selected=(selected&&visible.find(c=>c.key===selected.key))||visible.find(c=>c.status==='complete')||visible.find(c=>c.status==='disputed')||visible[0]||null;renderList();renderInspector();drawGraph()}
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

const canvas=$('#graph'),ctx=canvas.getContext('2d');let phase=0;
function resizeCanvas(){const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio,2);canvas.width=rect.width*scale;canvas.height=rect.height*scale;ctx.setTransform(scale,0,0,scale,0,0);drawGraph()}
function drawGraph(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);if(!selected){$('#emptyGraph').style.display='block';return}$('#emptyGraph').style.display='none';$('#graphTitle').textContent=`${selected.id} · ${selected.status.toUpperCase()}`;
  const margin=Math.max(70,w*.1),xs=[margin,w*.36,w*.64,w-margin],centerY=h*.54,nodeColors=['#d7ff55','#65bfff','#ffbe5c','#67e8a5'];
  const orbit=(phase*.008)%(Math.PI*2);ctx.strokeStyle='#131d28';ctx.lineWidth=1;for(let ring=0;ring<3;ring++){ctx.beginPath();ctx.arc(w/2,centerY,70+ring*52,orbit+ring,orbit+ring+Math.PI*1.35);ctx.stroke()}for(let particle=0;particle<8;particle++){const angle=orbit+particle*Math.PI/4,radius=92+(particle%3)*47;ctx.fillStyle=particle%2?'#65bfff':'#d7ff55';ctx.globalAlpha=.25+particle%3*.18;ctx.beginPath();ctx.arc(w/2+Math.cos(angle)*radius,centerY+Math.sin(angle)*radius,2+(particle%2),0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
  ctx.font='10px DM Mono';ctx.textAlign='center';for(let i=0;i<4;i++){ctx.fillStyle='#647184';ctx.fillText(STAGE_NAMES[i],xs[i],112)}
  for(let stage=0;stage<3;stage++){const from=selected.stages[stage],to=selected.stages[stage+1];if(!from.length||!to.length)continue;for(let a=0;a<from.length;a++)for(let b=0;b<to.length;b++){const y1=centerY+(a-(from.length-1)/2)*55,y2=centerY+(b-(to.length-1)/2)*55;ctx.strokeStyle='#2b3948';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xs[stage]+13,y1);ctx.bezierCurveTo((xs[stage]+xs[stage+1])/2,y1,(xs[stage]+xs[stage+1])/2,y2,xs[stage+1]-13,y2);ctx.stroke();const p=(phase*.004+(a+b)*.23)%1,px=xs[stage]+(xs[stage+1]-xs[stage])*p,py=y1+(y2-y1)*p;ctx.fillStyle=nodeColors[stage+1];ctx.beginPath();ctx.arc(px,py,2.5,0,Math.PI*2);ctx.fill()}}
  selected.stages.forEach((items,stage)=>items.slice(0,7).forEach((record,index)=>{const y=centerY+(index-(Math.min(items.length,7)-1)/2)*55,r=stage===0?18:13;ctx.shadowColor=nodeColors[stage];ctx.shadowBlur=14;ctx.fillStyle='#0a0e13';ctx.strokeStyle=nodeColors[stage];ctx.lineWidth=2;ctx.beginPath();ctx.arc(xs[stage],y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#cbd5e1';ctx.font='9px DM Mono';ctx.fillText(record.kind,xs[stage],y+3);ctx.fillStyle='#5e6c7d';ctx.fillText(`#${record.seq}`,xs[stage],y+r+14)}));
  const missing=STAGE_NAMES.filter((_,i)=>!selected.stages[i].length);if(missing.length){ctx.font='10px DM Mono';ctx.textAlign='center';ctx.fillStyle='#728095';ctx.fillText(`CURRENT WINDOW MISSING: ${missing.join(' · ')}`,w/2,h-46)}
}
function animate(){phase++;drawGraph();requestAnimationFrame(animate)}
$('#refresh').onclick=()=>refresh();$('#filter').onchange=e=>{filter=e.target.value;render()};addEventListener('resize',resizeCanvas);resizeCanvas();refresh();setInterval(refresh,15000);animate();
if(document.modelContext?.registerTool)document.modelContext.registerTool({name:'inspect_evidence_cases',title:'Inspect evidence cases',description:'Return structural observations for live Technocore work chains already loaded in Proofline.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','complete','disputed','partial','orphan']}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:({status='all'}={})=>({observed_at:new Date().toISOString(),cases:cases.filter(c=>status==='all'||c.status===status).slice(0,20).map(c=>({room:c.room,id:c.id,status:c.status,stages:c.stages.map(s=>s.length),negative_attestation:c.negative,lexical_overlap:c.semantic,records:c.list.length}))})});
