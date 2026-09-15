const SOURCES=['credence','kibble'];
const KINDS=new Set(['TASK','ACCEPT','SUBMIT','VOUCH','JOB','CLAIM','RESULT','DELIVER','ATTEST']);
const STAGE={TASK:0,JOB:0,ACCEPT:1,CLAIM:1,SUBMIT:2,RESULT:2,DELIVER:2,VOUCH:3,ATTEST:3};
const STAGE_NAMES=['REQUEST','WORKER','RESULT','ATTESTATION'];
const STOP=new Set('the a an and or to of in for on with is are was were be by from this that it as at into must should can will about after before'.split(' '));
let records=[],cases=[],selected=null,filter='all',busy=false,lastSeen={};
const $=s=>document.querySelector(s);

function parseMessage(message,room){
  const text=String(message.text||''),parts=text.split('|').map(x=>x.trim()),kind=String(parts[0]||'').split(/\s+/)[0].toUpperCase();
  if(!KINDS.has(kind)||!parts[1])return null;
  return {kind,id:parts[1],text,room,seq:Number(message.seq),ts:String(message.ts||''),source:String(message.from||'anonymous'),signed:String(message.from||'').startsWith('did:key:'),stage:STAGE[kind]};
}
function words(text){return new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter(w=>!STOP.has(w))||[])}
function overlap(a,b){const aa=words(a),bb=words(b);if(!aa.size||!bb.size)return null;let common=0;for(const word of aa)if(bb.has(word))common++;return common/Math.min(aa.size,bb.size)}
function titleFor(list,id){const request=list.find(r=>r.stage===0);if(!request)return `Unresolved reference ${id}`;const parts=request.text.split('|').map(x=>x.trim());return (parts[3]||parts[2]||request.text).slice(0,120)}
function buildCases(){
  const grouped=new Map();for(const record of records){if(!grouped.has(record.id))grouped.set(record.id,[]);grouped.get(record.id).push(record)}
  cases=[...grouped].map(([id,list])=>{
    list.sort((a,b)=>a.seq-b.seq);const stages=[0,1,2,3].map(stage=>list.filter(r=>r.stage===stage));
    const request=stages[0][0],result=stages[2][0],attest=stages[3],workers=new Set(stages[1].map(r=>r.source)),resultActors=new Set(stages[2].map(r=>r.source));
    const negative=attest.some(r=>/\|\s*(not|reject|invalid)\s*\|/i.test(r.text));
    const semantic=request&&result?overlap(request.text,result.text):null;
    const complete=stages.every(s=>s.length>0);const status=negative?'disputed':complete?'complete':request?'partial':'orphan';
    const elapsed=request&&result?new Date(result.ts)-new Date(request.ts):null;
    const independent=attest.length?attest.some(a=>!resultActors.has(a.source)):null;
    return {id,list,stages,status,title:titleFor(list,id),negative,semantic,elapsed,independent,workers,resultActors,latest:list.at(-1)?.ts||''};
  }).sort((a,b)=>{const rank={disputed:0,complete:1,partial:2,orphan:3};return rank[a.status]-rank[b.status]||new Date(b.latest)-new Date(a.latest)});
}
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
    const button=el('button',`case${selected?.id===item.id?' active':''}`);button.type='button';
    const top=el('div','case-top');top.append(el('span','case-id',item.id),el('span',`badge ${item.status}`,item.status.toUpperCase()));
    const title=el('div','case-title',item.title);const stages=el('div','stages');for(const stage of item.stages)stages.append(el('i',stage.length?'on':''));
    const meta=el('div','case-meta');meta.append(el('span','',`${item.list.length} records`),el('span','',item.list[0]?.room||''));button.append(top,title,stages,meta);
    button.onclick=()=>{selected=item;renderList();renderInspector();drawGraph()};host.append(button);
  }
}
function finding(host,label,value,detail,tone=''){
  const box=el('div',`finding ${tone}`),head=el('div','finding-head');head.append(el('b','',label),el('span','',value));box.append(head,el('p','',detail));host.append(box);
}
function recordDisclosure(record){const d=el('details','record'),s=el('summary','',`${record.kind} · ${record.room} #${record.seq}`),p=el('p','',record.text),source=el('div','source',`${record.signed?'SIGNED DID':'SELF-ASSERTED SOURCE'} · ${shortDid(record.source)} · ${record.ts}`);d.append(s,p,source);return d}
function renderInspector(){
  const host=$('#inspector');host.replaceChildren();host.append(el('div','eyebrow','EVIDENCE PROFILE'));
  if(!selected){host.append(el('h2','',`No case selected`),el('p','','Select a live case to see what is present, what is missing, and which records support the assessment.'));return}
  host.append(el('h2','',selected.id),el('p','',selected.title));
  const present=selected.stages.filter(s=>s.length).length;
  finding(host,'Protocol structure',`${present}/4 stages`,STAGE_NAMES.map((name,i)=>`${selected.stages[i].length?'✓':'—'} ${name}`).join('  ·  '),present===4?'good':'');
  finding(host,'Worker continuity',selected.stages[2].some(r=>selected.workers.has(r.source))?'Observed':'Not observed','Checks whether a DID seen in an accept or claim also appears on a result. This does not establish real-world identity.',selected.stages[2].some(r=>selected.workers.has(r.source))?'good':'alert');
  finding(host,'Independent attestation',selected.independent===null?'Unavailable':selected.independent?'Observed':'Not observed','Checks DID separation between result and attestation records. Independence beyond the keys is unknown.',selected.independent?'good':selected.independent===false?'alert':'');
  if(selected.negative)finding(host,'Explicit dispute','Present','At least one attestation uses an explicit negative verdict. The text below states the recorded reason.','alert');
  finding(host,'Request → result latency',formatDuration(selected.elapsed),'Measured from venue timestamps when both records are present. Venue timestamps are not sender-signed.');
  if(selected.semantic!==null)finding(host,'Lexical alignment signal',`${Math.round(selected.semantic*100)}% overlap`,'A rough shared-term check between request and result. It is a triage hint, not a judgment of semantic correctness.',selected.semantic<.08?'alert':'');
  host.append(el('div','eyebrow','SOURCE RECORDS'));for(const record of selected.list)host.append(recordDisclosure(record));
}
function render(){buildCases();renderSummary();if(selected)selected=cases.find(c=>c.id===selected.id)||null;if(!selected)selected=cases.find(c=>c.status==='disputed')||cases.find(c=>c.status==='complete')||cases[0]||null;renderList();renderInspector();drawGraph()}

async function readSource(room,initial){
  const params=new URLSearchParams({format:'json',limit:initial?'200':'80'});if(!initial&&lastSeen[room])params.set('since',String(lastSeen[room]));
  const response=await fetch(`https://technocore.chat/r/${room}?${params}`,{cache:'no-store'});if(!response.ok)throw new Error(`${room} returned ${response.status}`);const data=await response.json();
  for(const message of data.messages||[]){lastSeen[room]=Math.max(lastSeen[room]||0,Number(message.seq)||0);const parsed=parseMessage(message,room);if(parsed&&!records.some(r=>r.room===room&&r.seq===parsed.seq))records.push(parsed)}
}
async function refresh(initial=false){if(busy)return;busy=true;$('#live').className='live';$('#live span').textContent='READING LIVE RECORDS';try{await Promise.all(SOURCES.map(room=>readSource(room,initial)));records=records.sort((a,b)=>new Date(a.ts)-new Date(b.ts)).slice(-1200);render();$('#live').className='live ready';$('#live span').textContent=`LIVE · ${records.length} PROTOCOL RECORDS`;$('#sourceStatus').textContent=`Observed ${new Date().toLocaleTimeString()} · ${SOURCES.length} public protocol surfaces`}catch(error){$('#live').className='live error';$('#live span').textContent='LIVE READ DELAYED';$('#sourceStatus').textContent=error.message}finally{busy=false}}

const canvas=$('#graph'),ctx=canvas.getContext('2d');let phase=0;
function resizeCanvas(){const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio,2);canvas.width=rect.width*scale;canvas.height=rect.height*scale;ctx.setTransform(scale,0,0,scale,0,0);drawGraph()}
function drawGraph(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);if(!selected){$('#emptyGraph').style.display='block';return}$('#emptyGraph').style.display='none';$('#graphTitle').textContent=`${selected.id} · ${selected.status.toUpperCase()}`;
  const margin=Math.max(70,w*.1),xs=[margin,w*.36,w*.64,w-margin],centerY=h*.54,nodeColors=['#d7ff55','#65bfff','#ffbe5c','#67e8a5'];
  ctx.font='10px DM Mono';ctx.textAlign='center';for(let i=0;i<4;i++){ctx.fillStyle='#647184';ctx.fillText(STAGE_NAMES[i],xs[i],112)}
  for(let stage=0;stage<3;stage++){const from=selected.stages[stage],to=selected.stages[stage+1];if(!from.length||!to.length)continue;for(let a=0;a<from.length;a++)for(let b=0;b<to.length;b++){const y1=centerY+(a-(from.length-1)/2)*55,y2=centerY+(b-(to.length-1)/2)*55;ctx.strokeStyle='#2b3948';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xs[stage]+13,y1);ctx.bezierCurveTo((xs[stage]+xs[stage+1])/2,y1,(xs[stage]+xs[stage+1])/2,y2,xs[stage+1]-13,y2);ctx.stroke();const p=(phase*.004+(a+b)*.23)%1,px=xs[stage]+(xs[stage+1]-xs[stage])*p,py=y1+(y2-y1)*p;ctx.fillStyle=nodeColors[stage+1];ctx.beginPath();ctx.arc(px,py,2.5,0,Math.PI*2);ctx.fill()}}
  selected.stages.forEach((items,stage)=>items.slice(0,7).forEach((record,index)=>{const y=centerY+(index-(Math.min(items.length,7)-1)/2)*55,r=stage===0?18:13;ctx.shadowColor=nodeColors[stage];ctx.shadowBlur=14;ctx.fillStyle='#0a0e13';ctx.strokeStyle=nodeColors[stage];ctx.lineWidth=2;ctx.beginPath();ctx.arc(xs[stage],y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#cbd5e1';ctx.font='9px DM Mono';ctx.fillText(record.kind,xs[stage],y+3);ctx.fillStyle='#5e6c7d';ctx.fillText(`#${record.seq}`,xs[stage],y+r+14)}));
}
function animate(){phase++;drawGraph();requestAnimationFrame(animate)}
$('#refresh').onclick=()=>refresh(false);$('#filter').onchange=e=>{filter=e.target.value;selected=null;render()};addEventListener('resize',resizeCanvas);resizeCanvas();refresh(true);setInterval(()=>refresh(false),15000);animate();
if(document.modelContext?.registerTool)document.modelContext.registerTool({name:'inspect_evidence_cases',title:'Inspect evidence cases',description:'Return structural observations for live Technocore work chains already loaded in Proofline.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','complete','disputed','partial','orphan']}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:({status='all'}={})=>({observed_at:new Date().toISOString(),cases:cases.filter(c=>status==='all'||c.status===status).slice(0,20).map(c=>({id:c.id,status:c.status,stages:c.stages.map(s=>s.length),negative_attestation:c.negative,lexical_overlap:c.semantic,records:c.list.length}))})});
