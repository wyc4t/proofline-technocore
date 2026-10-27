import {STAGE_NAMES,parseMessage} from './lib/protocol.js';
import {ARCHIVE_RAW,parsePin,formatPin,loadPinned} from './lib/snapshot.js';
import {lookupCase} from './lib/lookup.js';
import {roomPopulation} from './lib/population.js';
import {loadGuidedCase} from './lib/examples.js';
import {buildCases,attestationTargetText} from './lib/cases.js';
import {reviewCase, evidenceAssessment,buildReuseIndex} from './lib/evidence.js';
import {parseRoomPage,annotateSignatures,annotateContentHashes,signatureSupport,checkSignature} from './lib/signature.js';
import {createRoomState,applyPage,querySince,markOk,markError,coverage,allRecords,PAGE_LIMIT} from './lib/store.js';
import {retainSelection,roomEpoch} from './lib/selection.js';
import {mountStoryline,storylineModel,storyPreview} from './lib/storyline.js';
import {formatUTCWindow,liveRoomText} from './lib/presentation.js';
const SOURCES=['credence','kibble'];
const rooms=SOURCES.map(createRoomState);
const SIG_LABEL={valid:'SIGNATURE VERIFIED',invalid:'SIGNATURE DOES NOT VERIFY',no_sig:'KEY NAMED, NO SIGNATURE · NOT RE-VERIFIABLE',unsigned:'NOT A KEY · SELF-ASSERTED NAME',unchecked:'SIGNATURE NOT CHECKED IN THIS BROWSER'};
const STATUS_LABEL={'all-stages':'ALL 4 STAGES','partial':'PARTIAL','no-request':'REQUEST NOT SEEN'};
const FETCH_TIMEOUT_MS=10000,LIST_STEP=80;
let cases=[],selected=null,filter='seen',stats=null,busy=false,paused=false,frozenAt=0,lastInspKey=null,listLimit=LIST_STEP,detailOpener=null;
const uiSig={list:'',insp:''};
const isNarrow=()=>matchMedia('(max-width:700px)').matches;
const protocolTotal=()=>rooms.reduce((n,r)=>n+r.counts.protocol,0);
const $=s=>document.querySelector(s);
// Case links: ?case=<room>:<id> selects a live case; adding &at=g<gen>:<from>-<to> loads exactly that
// window from the evidence archive instead, checked against the archive's manifest.
const SITE='https://proofline-technocore.vercel.app';
const linkParams=new URLSearchParams(location.search);
let wantedKey=linkParams.get('case'),wantedMissing=false,snapshot=null,archiveState=null;
let guidedCase=linkParams.get('guide')==='1'?wantedKey:null;
const assetBase=location.protocol==='file:'?SITE:'';
// Colons are kept readable in links: room:id and g0:from-to.
const q=(key,pin)=>`?case=${encodeURIComponent(key).replace(/%3A/gi,':')}${pin?`&at=${encodeURIComponent(pin).replace(/%3A/gi,':')}`:''}`;
function caseUrl(key,pin){return (location.protocol==='file:'?`${SITE}/`:location.origin+location.pathname)+q(key,pin)}
function setUrl(key,pin){try{history.replaceState(history.state,'',location.pathname+(key?q(key,pin)+(guidedCase===key?'&guide=1':''):'')+location.hash)}catch{}}

function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
function formatDuration(ms){if(ms===null||!Number.isFinite(ms))return 'Unavailable';if(ms<0)return 'Invalid ordering';const s=Math.round(ms/1000);if(s<60)return `${s}s`;const m=Math.floor(s/60);if(m<60)return `${m}m ${s%60}s`;return `${Math.floor(m/60)}h ${m%60}m`}
function shortDid(did){if(!did)return 'unknown sender';return did.startsWith('did:key:')?`${did.slice(8,18)}…${did.slice(-5)}`:did.slice(0,24)}
const clock=ms=>ms?new Date(ms).toLocaleTimeString([],{hour12:false}):'never';
const FILTER_LABEL={seen:'Request in view','all-stages':'All 4 stages',partial:'Partial',negative:'Negative verdict',conflicts:'Conflicting verdicts',disputed:'Disputed','no-request':'Request not seen',all:'All cases'};
const matches=(c,f)=>f==='all'||(f==='seen'?c.status!=='no-request':f==='negative'?c.negative:f==='conflicts'?!!c.conflicts.length:f==='disputed'?c.disputed:c.status===f);
// Search: job ID, sender key (any part of it) or text, over the live view.
let query='';
const hits=(c,q)=>!q||c.id.toLowerCase().includes(q)||c.title.toLowerCase().includes(q)||c.list.some(r=>(r.source||'').toLowerCase().includes(q)||r.text.toLowerCase().includes(q));
function visibleCases(){return cases.filter(c=>matches(c,filter)&&hits(c,query))}
function renderSummary(){
  for(const o of $('#filter').options)o.textContent=`${FILTER_LABEL[o.value]} (${cases.filter(c=>matches(c,o.value)).length})`;
  // The live view is only the newest records of each room; say how much, and what the filter hides.
  const win=rooms.map(coverage).map(c=>liveRoomText(c)).join(' · ');
  const hidden=filter==='seen'?cases.filter(c=>c.status==='no-request').length:0,note=$('#casesNote');
  note.replaceChildren();
  if(hidden){note.append(document.createTextNode(`${hidden} without a request hidden. `));const b=el('button','','Show them');b.type='button';b.onclick=()=>{filter='all';$('#filter').value='all';render(true)};note.append(b)}
  else note.append(document.createTextNode('Search covers the held live view. Older cases: use the archive.'));
  renderPopulation();
}
// Headline numbers: kibble over the last 24 hours, computed hourly from the signature-checked archive.
async function refreshStats(){try{const r=await fetch(`${ARCHIVE_RAW}stats/latest.json`,{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));stats=await r.json();renderStats()}catch{if(!stats){$('#sDetail').textContent='The archive\u2019s numbers could not be loaded yet; trying again shortly.';setTimeout(refreshStats,30000)}}}
function renderStats(){
  const k=stats?.rooms?.kibble;if(!k)return;
  const n=x=>x===null||x===undefined?'—':Number(x).toLocaleString('en-US'),p=x=>x===null||x===undefined?'—':`${Math.round(x)}%`,hm=t=>t?String(t).slice(11,16):'?';
  $('#sJobs').textContent=n(k.jobs.records);$('#sResult').textContent=p(k.outcomes.with_result_pct);$('#sUseful').textContent=p(k.outcomes.with_useful_attestation_pct);$('#sUsefulOther').textContent=p(k.outcomes.with_useful_non_result_key_attestation_pct);$('#sReposted').textContent=p(k.jobs.reposted_share_pct);
  $('#sScope').textContent=`kibble · ${formatUTCWindow(k.window_start,k.window_end)} · signature-checked archive`;
  $('#sDetail').textContent=`Records observed: ${formatUTCWindow(k.from_ts,k.to_ts)} · ${k.complete?'no known gaps':'has gaps: partial'} · ${k.covers_window_start&&k.covers_window_end?'window covered':'partial or unknown window coverage'} · ${n(k.jobs.requester_keys)} requester keys · ${n(k.signatures.valid)} signatures re-checked`;
  if($('#archivePopulation'))$('#archivePopulation').textContent=archiveContextText(k);
  $('.summary p').title=`Computed from the evidence archive at ${hm(stats.generated_at)} UTC. Hover a number for its definition.`;
}

function archiveContextText(k){
  const n=x=>x==null?'unavailable':Number(x).toLocaleString('en-US'),top=k.population?.attestations?.top;
  return `Archive window: ${n(k.attestations?.negative)} negative verdict records; ${n(k.conflicts?.cases)} same-result conflict cases. Most common attestation wording: ${top?`${top.records} of ${k.population.attestations.records} records (${top.share_pct}%)`:'unavailable'}. Counts describe records and claims, not correctness.`;
}
function renderPopulation(){
  const host=$('#livePopulation');if(!host)return;host.replaceChildren();
  for(const room of SOURCES){const rs=cases.filter(c=>c.room===room).flatMap(c=>c.list),p=roomPopulation(rs),cs=cases.filter(c=>c.room===room),negative=cs.reduce((n,c)=>n+c.verdicts.not,0),conflict=cs.filter(c=>c.conflicts.length).length;
    host.append(el('p','',`${room} held view: ${rs.length} protocol records; ${negative} negative verdict records; ${conflict} same-result conflict cases.`));
    for(const [name,t] of [['result',p.results],['attestation',p.attestations]])host.append(el('p','',t.top?`Most common ${name} wording: ${t.top.records} of ${t.records} records (${t.top.share_pct}%).`:`No repeated-text context available for ${name} records.`));
  }
  host.append(el('p','','Text is compared ignoring case and spacing. A repeated phrase is a pattern, not a verdict. The held view is not a population-wide sample.'));
}
let lookupRequest=0;
async function findArchivedCase(event){
  event.preventDefault();const token=++lookupRequest,host=$('#lookupResults'),button=$('#lookupSubmit');host.replaceChildren(el('p','','Reading the archive lookup index…'));button.disabled=true;
  try{
    const result=await lookupCase({room:$('#lookupRoom').value,id:$('#lookupId').value.trim(),base:ARCHIVE_RAW,fetchText:async(u,{allowMissing=false}={})=>{const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(r.status===404&&allowMissing)return null;if(!r.ok)throw Error(`lookup returned ${r.status}`);return r.text()}});
    if(token!==lookupRequest)return;host.replaceChildren();const s=result.status;
    host.append(el('p','',`Indexed captures: ${s.first_indexed_capture} – ${s.last_indexed_capture}. Older or unavailable records may be absent.`));
    if(s.index_gaps?.length||s.unavailable_captures||s.known_archive_gaps||s.unknown_generation)host.append(el('p','','The index has known gaps, unavailable inputs or unknown generations; these are candidates only.'));
    if(!result.candidates.length)host.append(el('p','','Not found in the available lookup index. This does not show that the case never existed.'));
    for(const c of result.candidates){const box=el('p',''),a=el('a','',`${c.key} · ${c.pin}`);a.href=caseUrl(c.key,c.pin);box.append(a,document.createTextNode(` · ${c.records} indexed records · request ${c.request_seen?'seen':'not seen'}${c.ambiguous?' · sequence reuse observed; this pin may be ambiguous':''}`));host.append(box)}
    host.append(el('p','','Opening a candidate re-checks its archive files and signatures. The locator itself does not verify the case or establish complete coverage.'));
  }catch(e){if(token===lookupRequest)host.replaceChildren(el('p','',`Archive lookup unavailable: ${e.message}. The index may not have been generated for this archive yet. Guided examples and existing pinned links still work.`))}
  finally{if(token===lookupRequest)button.disabled=false}
}
function syncOverview(){
  $('#overviewToggle').setAttribute('aria-expanded',String($('#overview').open));
}
$('#overview').open=false;
$('#overviewToggle').onclick=()=>{$('#overview').open=!$('#overview').open;syncOverview()};
$('#overview').addEventListener('toggle',syncOverview);
$('#menuToggle').onclick=()=>{const open=!document.body.classList.contains('menu-open');document.body.classList.toggle('menu-open',open);$('#menuToggle').setAttribute('aria-expanded',String(open))};
$('#casesToggle').onclick=()=>setCasesCollapsed(true);
$('#casesShow').onclick=()=>setCasesCollapsed(!document.body.classList.contains('cases-collapsed'));
function setCasesCollapsed(collapsed){document.body.classList.toggle('cases-collapsed',collapsed);$('#casesShow').setAttribute('aria-expanded',String(!collapsed));$('#casesToggle').setAttribute('aria-expanded',String(!collapsed));if(collapsed)$('#casesShow').focus();else $('#search').focus()}
$('#lookupForm').onsubmit=findArchivedCase;
function renderList(){
  const host=$('#caseList');host.replaceChildren();const visible=visibleCases();
  if(!visible.length){host.append(el('div','loading',query?`No case in the live view matches \u201c${query}\u201d. Search covers only the live view; for an older case, use Find an archived case.`:'No matching cases in the current observation window.'));return}
  for(const item of visible.slice(0,listLimit)){
    const button=el('button',`case${selected?.key===item.key?' active':''}`);button.type='button';button.dataset.key=item.key;if(selected?.key===item.key)button.setAttribute('aria-current','true');
    const top=el('div','case-top'),badges=el('span','badges');if(item.negative)badges.append(el('span','badge negative',`NEGATIVE ×${item.verdicts.not}`));if(item.conflicts.length)badges.append(el('span','badge conflict','CONFLICTING VERDICTS'));badges.append(el('span',`badge ${item.status}`,STATUS_LABEL[item.status]));
    top.append(el('span','case-id',item.id),badges);
    const title=el('div','case-title',item.title.length>120?item.title.slice(0,119).trimEnd()+'…':item.title);title.title=item.title;const stages=el('div','stages');const seen=item.stages.filter(x=>x.length).length;stages.setAttribute('role','img');stages.setAttribute('aria-label',`${seen} of 4 stages seen: ${STAGE_NAMES.filter((_,i)=>item.stages[i].length).join(', ')||'none'}`);for(const stage of item.stages)stages.append(el('i',stage.length?'on':''));
    const meta=el('div','case-meta');meta.append(el('span','',`${seen}/4 stages · ${item.list.length} ${item.list.length===1?'record':'records'}`),el('span','',item.room));button.append(top,title,stages,meta);if(item.attestationDetails.length)button.append(el('div','case-attest',caseAttestationLabel(item)));
    button.onclick=()=>choose(item);host.append(button);
  }
  if(visible.length>listLimit){const more=el('button','more',`Showing ${listLimit} of ${visible.length} cases · show ${Math.min(LIST_STEP,visible.length-listLimit)} more`);more.type='button';more.onclick=()=>{listLimit+=LIST_STEP;render(true)};host.append(more)}
}
function finding(host,label,value,detail,tone=''){
  const box=el('div',`finding ${tone}`),head=el('div','finding-head');head.append(el('b','',label),el('span','',value));box.append(head,el('p','',detail));host.append(box);
}
// Evidence review (experimental): each result against what its own task asks for. Only the checks that held up in
// CRED-EXP-002 are shown, as facts; there is no overall verdict and nothing is reported as verified.
let reuseCache={sig:'',index:null};
function liveReuseIndex(){const recs=allRecords(rooms),sig=`${recs.length}:${recs.at(-1)?.seq}`;if(reuseCache.sig!==sig)reuseCache={sig,index:buildReuseIndex(recs)};return reuseCache.index}
function evidenceReview(host,c){
  host.append(el('div','eyebrow','EVIDENCE REVIEW · EXPERIMENTAL'));
  const rv=reviewCase(c.list,{index:snapshot?null:liveReuseIndex()});
  if(!rv.available){finding(host,'Result against its task','Not possible','No request in view, so there is nothing to compare the results with.');return}
  const q=rv.requirements,hasRules=q.prohibited.length||q.exactReply||q.noSelfVouch;
  const asks=[q.prohibited.length&&`no ${q.prohibited.filter(k=>['ACCEPT','SUBMIT','VOUCH'].includes(k)).join('/')||'response'}`,q.exactReply&&`exactly “${q.exactReply}”`,q.noSelfVouch&&'no self-vouch',...q.deliverables.map(d=>d.label)].filter(Boolean);
  if(q.ambiguous)finding(host,'What the task asks','Not checked',`This job ID was posted ${q.ambiguous} times with different success lines, so no single list of required parts applies to every result.`);
  else finding(host,'What the task asks',asks.length?asks.join(' · '):'No automatic checks for this task. Read the success line and the results yourself.',q.successClause?`Success line: “${q.successClause.length>260?q.successClause.slice(0,259)+'…':q.successClause}”`:'The task has no success line. Read the result against the request yourself.');
  if(hasRules)finding(host,'Task instructions',rv.violations.length?`Not followed by ${rv.violations.length} ${rv.violations.length===1?'record':'records'}`:'No violation in the available records',rv.violations.length?rv.violations.map(v=>`#${v.seq} ${v.kind}: ${v.why}`).join('\n'):'No record in view goes against the task\u2019s instructions. Records outside the view or the archive are not covered.',rv.violations.length?'alert':'');
  const rs=rv.results;
  if(!rs.length)finding(host,'Results','None','No result in view to compare with the task.');
  else{
    if(q.deliverables.length)finding(host,'Detected text checks, per result',`${rs.filter(r=>r.parts.every(p=>p.present)).length} of ${rs.length} ${rs.length===1?'result passes':'results pass'} these checks`,rs.slice(0,8).map(r=>`#${r.seq}: ${r.parts.map(p=>`${p.label}: ${p.present?(p.how==='names'?'✓ (names mentioned only)':'✓'):'not detected'}`).join(' · ')}`).join('\n')+'\nText checks: found means the text contains something of that shape, for example an HTTP status, not that the value is right. Text pasted from the task does not count. "Names mentioned only" means each named item appears, not that anything useful is said about it. In the 20 Oct tests of earlier checks, about 1 in 10 readings was wrong. That rate has not been measured for JSON/table detection.');
    finding(host,'Evidence in the results',rs.some(r=>r.reusedIn>=2||r.refusal)?'Reused text or refusals':rs.some(r=>r.checkable)?'Concrete claims, not re-run':'Asserted only',rs.slice(0,8).map(r=>`#${r.seq}: ${[r.refusal&&'a refusal, not a result',r.reusedIn>=2&&`same text posted under ${r.reusedIn} other tasks in view`,!r.refusal&&r.requests.length&&`names ${r.requests.length} ${r.requests.length===1?'request':'requests'} (${r.requests.slice(0,2).join(', ')}${r.requests.length>2?', …':''})`,!r.refusal&&!r.checkable&&'nothing a reader could re-run or check'].filter(Boolean).join(' · ')||'concrete details given'}`).join('\n')+(snapshot?'\nReuse across tasks is checked in the live view only.':''));
  }
  finding(host,'Independent reproduction',rv.summary.reproduction.level==='not-performed'?'Not performed by Proofline':'',`Proofline re-runs nothing. ${rv.summary.reproduction.text.includes('claim')?rv.summary.reproduction.text.split(' · ')[1]+'.':'No attestation here claims to have reproduced it.'} An attestation saying "reproduced" is the attester\u2019s claim.`);
  const assessment=evidenceAssessment(rv);
  finding(host,'Assessment','',assessment.text,assessment.tone);
  const how=el('a','about-link','How this review was tested');how.href='https://github.com/wyc4t/proofline-technocore/blob/main/findings/2026-10-20-cred-exp-002/README.md';how.target='_blank';how.rel='noreferrer';
  host.lastChild.querySelector('p').append(' ',how);
}
function returnToGuide(){
  const guide=$('#inspector .reading-guide');if(!guide)return;
  guide.scrollIntoView({block:'start'});guide.querySelector('button')?.focus({preventScroll:true});
}
function caseAttestationLabel(c){
  const role=c.attestation.state==='ok'&&c.attestation.self>0&&c.attestation.other===0&&c.attestation.unknown===0?' · result-key attestations only':'';
  if(c.conflicts.length)return 'Opposite verdicts name the same result text'+role;
  const a=c.attestationDetails;
  if(a.every(t=>t.state==='unnamed'))return 'Attestations name no result'+role;
  if(a.some(t=>t.state!=='matched'))return 'Attestation targets missing or not confirmed'+role;
  return 'Attestation targets matched by hash'+role;
}
function attestationReview(host,c){
  if(!c.attestationDetails.length)return;
  finding(host,'What each attestation names','',c.attestationDetails.map(attestationTargetText).join('\n')+'\nHash matches bind text, not correctness or independent review.');
  if(c.verdicts.useful&&c.verdicts.not&&!c.conflicts.length){
    const unknown=c.attestationDetails.some(a=>(a.verdict==='useful'||a.verdict==='not')&&a.state!=='matched');
    finding(host,unknown?'Mixed verdicts, targets unknown':'Mixed verdicts on different result texts','',unknown?'The records do not establish whether the attesters judged the same result. Missing, unchecked or ambiguous targets are not treated as a conflict.':'The matched useful and negative verdicts name different result texts. This is not evidence of disagreement on one result.');
  }
}
function recordDisclosure(record,flagged){
  const d=el('details','record'),s=el('summary','',`${record.kind} · ${record.room} #${record.seq}${flagged?' · ⚑':''}`),p=el('p','',record.text),source=el('div',`source sig-${record.sigStatus}`,`${SIG_LABEL[record.sigStatus]} · ${shortDid(record.source)} · ${record.ts}`);
  const back=el('button','record-guide-return','← Back to the steps');back.type='button';back.onclick=returnToGuide;
  d.dataset.seq=String(record.seq);s.dataset.seq=String(record.seq);d.append(s);if($('#inspector .reading-guide'))d.append(back);d.append(source,p);const target=selected?.attestationDetails.find(a=>a.seq===record.seq);if(target)d.append(el('p','attestation-target',attestationTargetText(target)));return d;
}
let recordSelection=null,sourceOpener=null;
function openSourceRecord(seq){
  const c=recordSelection?.c||selected,r=c?.list.find(r=>r.seq===seq);if(!r)return;
  const dialog=$('#recordDialog');if(!dialog.open)sourceOpener=document.activeElement;
  recordSelection={c,seq};$('#recordTitle').textContent=`${r.kind} #${r.seq}`;
  const content=$('#recordContent');content.replaceChildren();
  content.append(el('p',`source sig-${r.sigStatus}`,`${SIG_LABEL[r.sigStatus]} · ${shortDid(r.source)}`),el('p','record-venue',`Venue timestamp: ${r.ts||'unavailable'} · not signed. Sequence #${r.seq} is not signed.`),el('pre','raw-source',r.text));
  const key=el('p','source-key',r.source||'No sender');content.append(key);
  const item=storylineModel(c).flatMap(g=>g.records).find(i=>i.record.seq===seq);
  for(const text of item?.relations||[])content.append(el('p','source-relationship',text));
  for(const f of c.flags.filter(f=>f.seqs.includes(seq)))content.append(el('p','source-pattern',`Pattern: ${f.label}. ${f.detail}`));
  if(guidedCase===c.key){const back=el('button','','Back to the guide');back.onclick=()=>{sourceOpener=$('#inspector .reading-guide button');dialog.close();returnToGuide()};content.append(back)}
  const index=c.list.indexOf(r);$('#recordPrev').disabled=index===0;$('#recordNext').disabled=index===c.list.length-1;
  if(!dialog.open)dialog.showModal();else $('#recordTitle').focus();
  $('#recordTitle').tabIndex=-1;
}
$('#recordClose').onclick=()=>$('#recordDialog').close();
$('#recordDialog').addEventListener('click',e=>{if(e.target===$('#recordDialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close()}});
$('#recordDialog').addEventListener('close',()=>{const target=sourceOpener?.isConnected?sourceOpener:document.querySelector(`[data-record="${recordSelection?.seq}"]`);target?.focus({preventScroll:true});recordSelection=null});
for(const [id,step] of [['#recordPrev',-1],['#recordNext',1]])$(id).onclick=()=>{const c=recordSelection?.c,i=c?.list.findIndex(r=>r.seq===recordSelection.seq);if(c?.list[i+step])openSourceRecord(c.list[i+step].seq)};
let guideStep=0,guideKey=null;
function readingGuide(c){
  if(guideKey!==c.key){guideStep=0;guideKey=c.key}
  const box=el('section','reading-guide');box.setAttribute('aria-label','Read this case step by step');
  const stages=[0,2,3,null],questions=['What work was requested? Read the success line.','What was submitted? Compare it with the request.','Which result does each verdict name, and what does the attester claim?','Does the result meet the request? Decide yes, no or unsure. What evidence is missing?'];
  box.append(el('h3','',`Step ${guideStep+1} of 4 · ${['Request','Results','Attestations','Your assessment'][guideStep]}`),el('p','',questions[guideStep]));
  const stage=stages[guideStep];if(stage!==null){for(const r of c.stages[stage].slice(0,3)){const b=el('button','',`Read ${r.kind} #${r.seq}`);b.type='button';b.onclick=()=>openSourceRecord(r.seq);box.append(b)}if(c.stages[stage].length>3)box.append(el('p','',`${c.stages[stage].length-3} more records are available under Show all in that storyline stage, or All source records.`));if(!c.stages[stage].length)box.append(el('p','','No record for this stage in this window. This step cannot be checked from these records.'))}
  else box.append(el('p','','A signature or attestation alone does not establish that the work was correct. Proofline does not collect or save your assessment.'));
  const nav=el('div','guide-nav');for(const [text,delta] of [['Previous step',-1],['Next step',1]]){const b=el('button','',text);b.disabled=guideStep+delta<0||guideStep+delta>3;b.type='button';b.onclick=()=>{guideStep+=delta;render(true);$('#inspector .reading-guide h3')?.focus({preventScroll:true})};nav.append(b)}box.append(nav);box.querySelector('h3').tabIndex=-1;
  return {box};
}
let storyCleanup=null,storyExpanded=new Set(),storyKey=null;
function disclosure(host,title,key){const d=el('details','case-disclosure');d.dataset.seq=key;const summary=el('summary','',title);summary.dataset.seq=key;d.append(summary);host.append(d);return d}
function renderInspector(){
  storyCleanup?.();storyCleanup=null;
  const host=$('#inspector');host.replaceChildren();
  const back=el('button','back','← All cases');back.type='button';back.onclick=closeDetail;host.append(back);
  if(snapshot?.loading){const status=el('p','archive-loading',`${snapshot.progress||'Fetching the archived records…'} This can take a few seconds. The case opens automatically when its checks finish.`);status.setAttribute('role','status');host.append(el('h1','',guidedCase===snapshot.key?'Opening guided example':'Opening archived case'),status);return}
  if(snapshot?.error){host.append(el('h1','','Archived case unavailable'),el('p','',snapshot.error));const exit=el('button','','Back to live cases');exit.onclick=()=>{snapshot=null;selected=null;setUrl(null);render(true)};host.append(exit);return}
  if(!snapshot&&wantedMissing){host.append(el('h1','',wantedKey),el('p','','This case is not in the held live view. Use an archived case or a pinned link to inspect older records.'));return}
  if(!selected){host.append(el('h1','','Inspect the evidence behind a claim.'),el('p','','Choose a case to compare the request with the result, see which result each verdict names, and cite the archive.'));const a=el('a','','Try a guided example');a.href='examples.html';host.append(a);return}
  const c=selected,present=c.stages.filter(s=>s.length).length;
  const context=el('div','case-context');context.append(el('span','eyebrow',snapshot?snapshot.curated?'ARCHIVED · GUIDED CASE BUNDLE':'ARCHIVED SNAPSHOT':'HELD LIVE VIEW'));if(snapshot){const exit=el('button','text-button','Back to live cases');exit.onclick=()=>{snapshot=null;selected=null;guidedCase=null;setUrl(null);render(true)};context.append(exit)}const heading=storyPreview(c.title,180);host.append(context,el('h1','case-heading',heading.text));if(heading.truncated)host.append(el('p','title-excerpt','Request title excerpt · open the request card for the complete source.'));
  const meta=el('div','case-heading-meta');meta.append(el('span','',c.id),el('span','badge',`${present} OF 4 STAGES OBSERVED`));
  if(c.conflicts.length)meta.append(el('span','badge',`${c.conflicts.length} RESULT TEXT${c.conflicts.length===1?'':'S'} WITH OPPOSITE VERDICTS`));
  if(c.disputed)meta.append(el('span','badge','DISPUTED · CLAIM'));
  host.append(meta,el('p','case-scope',`${c.room} · ${formatUTCWindow(c.list[0]?.ts,c.list.at(-1)?.ts)} · ${c.list.filter(r=>r.sigStatus==='valid').length} of ${c.list.length} signatures verified`));
  host.append(el('p','case-caveat',"Signed records show which key posted what. They don't show the work is correct, that different keys are different operators, or that anything was paid."));
  const actions=el('div','case-actions'),guide=guidedCase===c.key?readingGuide(c):null,toggle=el('button','guide-toggle',guide?'Hide the guide':'Guide me through this case');toggle.replaceChildren(el('span','guide-label-wide',guide?'Hide the guide':'Guide me through this case'),el('span','guide-label-short',guide?'Hide guide':'Guide me'));toggle.type='button';toggle.setAttribute('aria-expanded',String(!!guide));toggle.onclick=()=>{guidedCase=guide?null:c.key;setUrl(c.key,snapshot?.pin);render(true);$('#inspector .guide-toggle')?.focus({preventScroll:true})};actions.append(toggle,citeBlock(c));host.append(actions);
  if(snapshot){const d=disclosure(host,'Archive scope and capture checks','archive-scope');d.classList.add('snapshot-banner');
    d.append(el('p','',snapshot.curated?`${snapshot.records} selected case records, checked against this build's bundle manifest. Other records in window #${snapshot.from}–#${snapshot.to} are omitted. This bundle does not establish independent capture time or completeness of the surrounding window.`:`${snapshot.records} room records in window #${snapshot.from}–#${snapshot.to}${snapshot.epoch?` · storage epoch ${snapshot.epoch}`:''}, from ${snapshot.captures.length} captures checked against the archive manifest. Later records of this case are not included.`));
    if(snapshot.missing){const warning=el('p','archive-warning',`${snapshot.missing} sequence numbers in the window are missing from the archive.`);host.append(warning);d.open=true}
  }
  if(!snapshot&&(c.retained||!visibleCases().some(v=>v.key===c.key))){const notice=el('div','retained-case');notice.setAttribute('role','status');notice.append(el('b','',c.retained?'This case has left the live view.':'Outside the current filter or search.'),el('p','','Its records remain in this browser until another case is chosen or the page reloads.'));if(c.epochChanged)notice.append(el('p','','A room reset was observed; these records remain separate. Use archive lookup to establish a pinned copy.'));host.append(notice)}
  if(c.list.some(r=>r.sigStatus==='invalid'))host.append(el('p','archive-warning','Signature failure: one or more records do not verify. Open the affected cards before comparing their claims.'));
  if(guide)host.append(guide.box);
  const intro=el('div','story-heading');intro.append(el('h2','','Case storyline'));const keyNote=el('p','');keyNote.append(el('span','story-key-wide','Stages, not causes · green line: checked result-hash match · dashed: same verified key. Open a card for its full source. Connections are also written on each card.'),el('span','story-key-narrow','Open a card for its full source. Stages are categories, not causes; targets are named on the cards.'));intro.append(keyNote);host.append(intro);
  const story=el('div','');host.append(story);const key=`${c.key}|${snapshot?.pin||c.liveEpoch}`;if(storyKey!==key){storyExpanded=new Set();storyKey=key}storyCleanup=mountStoryline(story,c,{onSelect:openSourceRecord,expanded:storyExpanded});
  if(present<4)host.append(el('p','case-caveat','An empty stage means no record was seen in this window. It does not establish that the stage never happened.'));
  if(c.verdicts.useful&&c.verdicts.not&&!c.conflicts.length)host.append(el('p','case-caveat','Useful and negative claims are present, but a checked hash match does not place them on the same result text. Read the targets on each attestation.'));
  const checks=el('div','case-checks');host.append(checks);
  const citeHelp=actions.querySelector('.cite-help');if(citeHelp){citeHelp.classList.add('case-disclosure');checks.append(citeHelp)}
  const archiveScope=host.querySelector('.snapshot-banner');if(archiveScope)checks.append(archiveScope);
  renderCaseChecks(checks,c);
}
function renderCaseChecks(checks,c){
  let host=disclosure(checks,`Signatures · ${c.list.filter(r=>r.sigStatus==='valid').length} of ${c.list.length} verified`,'signatures');
  const sc=c.list.reduce((m,r)=>(m[r.sigStatus]=(m[r.sigStatus]||0)+1,m),{});
  finding(host,'Signatures',['valid','invalid','no_sig','unsigned','unchecked'].filter(k=>sc[k]).map(k=>`${sc[k]} ${{valid:'verified',invalid:'fail',no_sig:'no signature',unsigned:'nickname',unchecked:'not checked'}[k]}`).join(' · '),
    sc.invalid?'At least one record names a key but its signature does not verify. That record is not treated as coming from that key.':sc.unchecked&&!sc.valid?'Your browser cannot check these signatures, so no record here is compared as coming from a key.':'A verified signature shows that the key signed this room, nonce and text. It does not show who holds the key or that the work is correct. Sequence numbers and times are added by Technocore and are not signed.',sc.invalid?'alert':'');
  host=disclosure(checks,'Timing · '+(c.elapsedFirst===null?'unavailable':`first ${formatDuration(c.elapsedFirst)} · last ${formatDuration(c.elapsedLast)}`),'timing');
  finding(host,'Request → result timing',c.elapsedFirst===null?'Unavailable':`first ${formatDuration(c.elapsedFirst)}${c.elapsedLast!==c.elapsedFirst?` · last ${formatDuration(c.elapsedLast)}`:''}`,'From venue timestamps, which are not signed by the sender. The first result is not necessarily the substantive one.');
  host=disclosure(checks,'Evidence review · experimental text checks','evidence-review');evidenceReview(host,c);
  host=disclosure(checks,'Key relationships, targets and other observations','relationships');
  if(c.targets.length){const m=c.attestationDetails.filter(a=>a.state==='matched').length;
    finding(host,'Attestations that name a result',`${m} checked hash matches`, 'Hash matches bind result text, not correctness. Unnamed, missing, unchecked and ambiguous targets are described separately below. Identical text can match more than one result record.')}
  attestationReview(host,c);
  for(const w of c.witnesses)finding(host,'Job countersign (WITNESS)',w.matches?'matches the job text':w.checkable?'does not match':'job not in view',`A WITNESS record by ${shortDid(w.source)} binds the exact job text by hash. ${w.matches?'Its hash matches the JOB record of this case.':w.checkable?'Its hash does not match the JOB record shown here.':'The JOB record it refers to is not in view.'} It shows that key saw this text; it says nothing about the work.`,w.checkable&&!w.matches?'alert':'');
  if(c.disputes.length)finding(host,'Disputed',c.resolutions.length?c.resolutions.map(r=>r.outcome).join(', '):'no resolution',`${c.disputes.length} ${c.disputes.length===1?'DISPUTE':'DISPUTE records'}: ${[...new Set(c.disputes.map(d=>d.reason))].join(', ')}. A dispute and a resolution are claims by their keys, not findings.`,'alert');
  const cont={'observed':['Observed','A key that accepted or claimed also posted a result.'],'not-observed':['Not observed','No result was posted by a key that accepted or claimed.'],'no-worker':['Unavailable','No accept or claim in the window.'],'no-result':['Unavailable','No result in the window.'],'no-key':['Unavailable','The worker or result records do not come from keys with a verified signature, so keys cannot be compared.']}[c.continuity];
  if(c.continuity!=='observed')finding(host,'Key continuity (worker → result)',cont[0],`${cont[1]} Keys are not people; this says nothing about real-world identity.`);
  const a=c.attestation,av={'no-attestation':['None observed','No attestation in the window.'],'no-result':['Unavailable','Attestations are present, but no result is in the window to compare keys against.'],'no-key':['Unavailable','The result records do not come from keys with a verified signature, so attestation keys cannot be compared.'],'ok':[`${a.other} by keys with no result here · ${a.self} by result keys${a.unknown?` · ${a.unknown} with no comparable verified key`:''}`,'Counts attestation records by whether the same verified key appears on a result in this case. This does not show which result was judged or whether the claim is correct. One operator can hold many keys. Unsigned senders are not compared.']}[a.state];
  finding(host,'Attestation keys',av[0],av[1]);
  const v=c.verdicts;if(c.attestation.state!=='no-attestation')finding(host,'Recorded verdicts',`useful ${v.useful} · negative ${v.not}${v.other?` · other ${v.other}`:''}`,v.not?'At least one attestation carries an explicit negative verdict. Read its text below; it is a claim by that key, not a finding.':'Verdicts are claims made by the posting keys.',v.not?'alert':'');
  if(c.flags.length){host.append(el('div','eyebrow','PATTERNS IN THE COMPARED RECORDS'));const repeated=c.flags.filter(f=>f.id==='reused-result'||f.id==='reused-attestation'),rest=c.flags.filter(f=>!repeated.includes(f));
    const show=(target,f)=>finding(target,f.label,`${f.seqs.length} ${f.seqs.length===1?'record':'records'}`,`${f.detail} Seq ${f.seqs.slice(0,6).map(s=>'#'+s).join(', ')}${f.seqs.length>6?'…':''}. A pattern, not a verdict.`);
    for(const f of rest)show(host,f);if(repeated.length){const d=el('details','pattern-details');d.dataset.seq='reuse-patterns';const summary=el('summary','',`Repeated-text patterns (${repeated.length})`);summary.dataset.seq='reuse-patterns';d.append(summary,el('p','','Comparison set: this room’s live records plus this selected case if retained. Archived snapshots compare only the records loaded.'));for(const f of repeated)show(d,f);host.append(d)}
  }
  host=disclosure(checks,`All source records · ${c.list.length}`,'all-sources');
  const flagged=new Set(c.flags.flatMap(f=>f.seqs));for(const r of c.list)host.append(recordDisclosure(r,flagged.has(r.seq)));
}

function citeBlock(c){
  const box=el('div','cite-bar'),row=el('div','cite-row');
  const seqs=c.list.map(r=>r.seq),from=snapshot?snapshot.from:Math.min(...seqs),to=snapshot?snapshot.to:Math.max(...seqs);
  const gen=snapshot?snapshot.gen:String(c.liveGeneration??rooms.find(r=>r.room===c.room)?.generation??0);
  const pin=snapshot?snapshot.pin:formatPin(gen,from,to),st=archiveState?.rooms?.[c.room];
  const archived=!!snapshot||(st&&String(st.generation)===gen&&st.last_seq>=to);
  const button=(label,url,primary)=>{const b=el('button',`copy${primary?' primary':''}`,label);b.type='button';
    b.onclick=async()=>{try{await navigator.clipboard.writeText(url);b.textContent='Copied ✓'}catch{b.textContent='Copy failed'}setTimeout(()=>{b.textContent=label},1600)};return b};
  if(!snapshot&&(!st||Number(st.storage_epoch||0)>0||rooms.find(r=>r.room===c.room)?.resets>0||(rooms.find(r=>r.room===c.room)?.lastSeq>0&&st.last_seq>rooms.find(r=>r.room===c.room).lastSeq))){
    row.append(button('Copy live link',caseUrl(c.key),false));
    box.append(row,el('p','cite-note','An archive storage epoch has not been established for this live case. Use Find an archived case to choose an epoch-qualified, checked copy.'));
    return box;
  }
  row.append(button('🔗 Copy pinned link',caseUrl(c.key,pin),true));
  if(!snapshot)row.append(button('Copy live link',caseUrl(c.key),false));
  const note=el('p','cite-note'),a=el('a','','Pinned link');a.href=caseUrl(c.key,pin);
  note.append(a,document.createTextNode(snapshot?.curated?': opens the full archived sequence window, including other cases and any gaps; it may load more data than this guided bundle.':archived?`: loads exactly records #${from}–#${to} from the evidence archive and checks them. Use it to cite.`
    :st?': not in the evidence archive yet. Captures were about 30 minutes apart in the 27 Oct 2026 review; they may be delayed or skipped. This link works once a capture includes these records.':': archive status unknown right now.'));
  if(!snapshot)note.append(document.createTextNode(' The live link shows the case only while it is in the live view.'));
  const help=el('details','cite-help');help.dataset.seq='citation-scope';const hs=el('summary','','Pinned link scope');hs.dataset.seq='citation-scope';help.append(hs,note);box.append(row,help);return box;
}
function openDetailIfNarrow(){if(isNarrow()&&!document.body.classList.contains('detail')){detailOpener=null;document.body.classList.add('detail');setDetailInert(true)}}
async function openSnapshot(key,pinText){
  const pin=parsePin(pinText),[room,id]=String(key).split(':');
  snapshot={key,room,id,pin:pinText,loading:true};render(true);openDetailIfNarrow();
  if(!pin||!room||!id){snapshot={...snapshot,loading:false,error:'This is not a valid pinned case link.'};render(true);return}
  try{
    const fetchText=async u=>{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(`the archive index returned ${r.status}`);return r.text()};
    const fetchBytes=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(`an archive file returned ${r.status}`);return new Uint8Array(await r.arrayBuffer())};
    const bundleBase=location.protocol==='file:'?SITE+'/':new URL('.',location.href).href;
    const res=(guidedCase===key?await loadGuidedCase({key,pin:pinText,base:bundleBase,fetchText,fetchBytes}):null)
      ?? await loadPinned({room,gen:pin.gen,epoch:pin.epoch??0,from:pin.from,to:pin.to,fetchText,fetchBytes,assetUrl:(t,a)=>`${assetBase}/api/asset?tag=${encodeURIComponent(t)}&asset=${encodeURIComponent(a)}`});
    snapshot={...snapshot,progress:'Records downloaded. Checking signatures…'};render(true);
    const dec=new TextDecoder(),msgs=res.lines.map(l=>parseRoomPage(dec.decode(l)));await annotateSignatures(room,msgs);await annotateContentHashes(msgs);
    const recs=msgs.map(m=>parseMessage(m,room)).filter(p=>p.ok).map(p=>p.record).filter(r=>r.id===id);
    const c=buildCases(recs)[0]||null;
    snapshot={key,room,id,pin:pinText,gen:pin.gen,epoch:pin.epoch??0,from:pin.from,to:pin.to,loading:false,case:c,captures:res.captures,missing:res.missing,records:res.lines.length,curated:!!res.curated,bundle:res.bundle,
      error:c?null:res.lines.length?'The evidence archive has records in that window, but none of this case.':'That window is not in the evidence archive yet.'};
  }catch(e){snapshot={...snapshot,loading:false,error:`The archive could not be loaded or checked: ${e?.message||e}.`}}
  render(true);
}
async function refreshArchiveState(){try{const r=await fetch(`${ARCHIVE_RAW}state.json`,{cache:'no-store'});if(r.ok){archiveState=await r.json();render()}}catch{}}
function snapshotUi(){const ae=document.activeElement,inList=ae&&ae.closest?.('#caseList'),inInsp=ae&&ae.closest?.('#inspector');
  return {focusKey:inList?ae.dataset.key:null,focusSeq:inInsp?ae.dataset?.seq??null:null,focusRecord:inInsp?ae.dataset?.record??null:null,list:$('#caseList').scrollTop,insp:$('#inspector').scrollTop,open:[...document.querySelectorAll('#inspector details[open]')].map(d=>d.dataset.seq)}}
function listSignature(visible){return `${filter}|${selected?.key}|${listLimit}|${visible.length}|`+visible.slice(0,listLimit).map(c=>`${c.key}:${c.fingerprint}`).join('\n')}
function inspectorSignature(){
  if(snapshot)return `snap|${snapshot.loading}|${snapshot.error||''}|${selected?.fingerprint||''}`;
  if(wantedMissing)return `missing|${wantedKey}`;
  if(!selected)return 'none';
  const to=Math.max(...selected.list.map(r=>r.seq)),st=archiveState?.rooms?.[selected.room];
  return `${selected.key}|${selected.liveEpoch}|${selected.retained}|${selected.epochChanged}|${visibleCases().some(c=>c.key===selected.key)}|${selected.fingerprint}|${st?(st.last_seq>=to?'archived':'pending'):'unknown'}|${st?.storage_epoch??0}`;
}
// Re-render only what changed, and put back scroll position, open records and keyboard focus. Selecting another case starts fresh.
function render(force=false){
  if(!paused)cases=buildCases(allRecords(rooms)).map(c=>{const state=rooms.find(r=>r.room===c.room);return {...c,liveEpoch:roomEpoch(state),liveGeneration:String(state.generation??0)}});
  renderSummary();
  if(!snapshot&&wantedKey){
    const hit=cases.find(c=>c.key===wantedKey);
    if(hit){if(!visibleCases().includes(hit)){filter='all';$('#filter').value='all'}selected=hit;wantedKey=null;wantedMissing=false;openDetailIfNarrow()}
    else if(rooms.every(r=>r.lastOkAt||r.status==='error'))wantedMissing=true;
  }
  const visible=visibleCases();
  if(snapshot)selected=snapshot.case||null;
  else if(wantedMissing)selected=null;
  else selected=(paused?selected:retainSelection(selected,cases,allRecords(rooms),rooms))||visible.find(c=>c.status==='all-stages')||visible[0]||null;
  if(selected&&!lastInspKey){const index=visible.findIndex(c=>c.key===selected.key);if(index>=listLimit)listLimit=Math.ceil((index+1)/LIST_STEP)*LIST_STEP}
  const ls=listSignature(visible),is=inspectorSignature();
  if(force||ls!==uiSig.list||is!==uiSig.insp){
    const ui=snapshotUi(),sameCase=selected?.key===lastInspKey;
    if(force||ls!==uiSig.list){renderList();$('#caseList').scrollTop=ui.list;if(ui.focusKey)$('#caseList').querySelector(`[data-key="${CSS.escape(ui.focusKey)}"]`)?.focus({preventScroll:true})}
    if(force||is!==uiSig.insp){renderInspector();if(!sameCase)$('#inspector').scrollTop=0;if(sameCase){for(const d of document.querySelectorAll('#inspector details'))if(ui.open.includes(d.dataset.seq))d.open=true;$('#inspector').scrollTop=ui.insp;if(ui.focusSeq)$('#inspector').querySelector(`summary[data-seq="${CSS.escape(ui.focusSeq)}"]`)?.focus({preventScroll:true});if(ui.focusRecord)$('#inspector').querySelector(`[data-record="${CSS.escape(ui.focusRecord)}"]`)?.focus({preventScroll:true})}}
    if(selected&&selected.key!==lastInspKey)$('#caseList').querySelector(`[data-key="${CSS.escape(selected.key)}"]`)?.scrollIntoView({block:'nearest'});
    uiSig.list=ls;uiSig.insp=is;lastInspKey=selected?.key??null;
  }
}
function choose(item){selected=selected?.key===item.key&&selected.liveEpoch===item.liveEpoch?(paused?selected:retainSelection(selected,cases,allRecords(rooms),rooms)):item;snapshot=null;wantedKey=null;wantedMissing=false;if(isNarrow()){detailOpener=document.activeElement;document.body.classList.add('detail');history.pushState({detail:1},'');setDetailInert(true)}setUrl(item.key);render(true);if(isNarrow()){$('#inspector').scrollTop=0;$('#inspector .back')?.focus({preventScroll:true})}}
function setDetailInert(on){for(const sel of ['.cases'])document.querySelector(sel)?.toggleAttribute('inert',on);const i=$('#inspector');if(on){i.setAttribute('role','region');i.setAttribute('aria-label','Case detail')}else{i.removeAttribute('role');i.removeAttribute('aria-label')}}
function exitDetail(){if(!document.body.classList.contains('detail'))return;document.body.classList.remove('detail');setDetailInert(false);const k=selected?.key,target=(k&&$('#caseList').querySelector(`[data-key="${CSS.escape(k)}"]`))||detailOpener;target?.focus?.({preventScroll:true})}
function closeDetail(){if(history.state?.detail)history.back();else exitDetail()}
matchMedia('(max-width:700px)').addEventListener('change',()=>{if(isNarrow()&&snapshot)openDetailIfNarrow();setDetailInert(isNarrow()&&document.body.classList.contains('detail'))});
addEventListener('popstate',exitDetail);
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('detail')&&!document.querySelector('dialog[open]'))closeDetail()});
function fmtSpan(ms){if(ms===null)return 'no data';const s=Math.round(ms/1000);if(s<90)return `${s}s`;const m=Math.round(s/60);if(m<120)return `${m}m`;const h=Math.round(m/60);return h<48?`${h}h`:`${Math.round(h/24)}d`}
function coverageLine(c){const bits=[liveRoomText(c),`${c.records} protocol records`];if(c.status==='error')bits.push(`delayed · last ok ${clock(c.lastOkAt)}`);if(c.gaps)bits.push(`${c.missed} missed`);if(c.resets)bits.push(`${c.resets} reset`);if(c.malformed+c.unsupported)bits.push(`${c.malformed+c.unsupported} unparsed`);const inv=[...rooms.find(r=>r.room===c.room).records.values()].filter(r=>r.sigStatus==='invalid').length;if(inv)bits.push(`${inv} signature ${inv===1?'fails':'fail'}`);return bits.join(' · ')}
async function pollRoom(state){
  const params=new URLSearchParams({format:'json',limit:String(PAGE_LIMIT)});const since=querySince(state);if(since!==null)params.set('since',String(since));
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),FETCH_TIMEOUT_MS);
  try{
    const response=await fetch(`https://technocore.chat/r/${state.room}?${params}`,{cache:'no-store',signal:ctl.signal});if(!response.ok)throw new Error(`${state.room} returned ${response.status}`);
    const page=parseRoomPage(await response.text());await annotateSignatures(state.room,page?.messages);await annotateContentHashes(page?.messages);
    applyPage(state,page,{since});markOk(state,Date.now());
  }catch(error){throw ctl.signal.aborted?new Error(`${state.room} did not answer within ${FETCH_TIMEOUT_MS/1000}s`):error}
  finally{clearTimeout(timer)}
}
function updateStatus(){
  const cov=rooms.map(coverage),bad=cov.filter(c=>c.status==='error'),gaps=cov.reduce((n,c)=>n+c.gaps,0);
  $('#live').className=`live ${bad.length===cov.length?'error':bad.length||gaps||paused?'warn':'ready'}`;
  $('#live span').textContent=paused?`PAUSED · ${Math.max(0,protocolTotal()-frozenAt)} NEW`:bad.length===cov.length?'LIVE READ DELAYED':bad.length?`PARTIAL · ${bad.map(c=>c.room.toUpperCase()).join(', ')} DELAYED`:`LIVE VIEW · ${cov.map(c=>liveRoomText(c,Date.now(),true)).join(' · ')}${gaps?' · GAPS':''}`;
  $('#freshness').textContent=(paused?'View paused; background reads continue. ':'')+cov.map(c=>liveRoomText(c)).join(' | ');
  $('#sourceStatus').textContent=cov.map(coverageLine).join('  |  ')+(signatureSupport()===false?'  |  this browser cannot check signatures, so keys are not compared':'');$('#sourceStatus').title=bad.map(c=>c.error).join('\n');
  const b=$('#pause');b.setAttribute('aria-pressed',String(paused));b.querySelector('.ico').textContent=paused?'▶':'⏸';b.querySelector('.lbl').textContent=paused?`Resume · ${Math.max(0,protocolTotal()-frozenAt)} new`:'Pause updates';b.setAttribute('aria-label',paused?'Resume live updates':'Pause live updates');
}
async function refresh(){if(busy)return;busy=true;if(!paused){$('#live').className='live';$('#live span').textContent='READING LIVE RECORDS'}
  // Each room settles on its own (bounded by the timeout) and is shown as soon as it answers; one stalled room cannot hold back the other.
  try{await Promise.all(rooms.map(async state=>{try{await pollRoom(state)}catch(error){markError(state,error?.message||error,Date.now())}if(!paused)render();updateStatus()}))}finally{busy=false}
  updateStatus();
}
function togglePause(){paused=!paused;if(paused)frozenAt=protocolTotal();else render(true);updateStatus()}

// The maintainer's key is fixed here, so a statement signed by any other key can never pass as the maintainer's.
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
const about=$('#aboutDialog');
function openAbout(){if(typeof about.showModal==='function'&&!about.open)about.showModal()}
$('#about').onclick=openAbout;$('#aboutClose').onclick=()=>about.close();
about.addEventListener('click',e=>{if(e.target===about)about.close()});
about.addEventListener('close',()=>{try{if(location.hash==='#about')history.replaceState(null,'',location.pathname+location.search)}catch{}});
document.addEventListener('click',e=>{if(e.target.closest?.('.about-link')){e.preventDefault();openAbout()}});
if(location.hash==='#about')openAbout();
if(wantedKey&&linkParams.get('at')){openSnapshot(wantedKey,linkParams.get('at'));wantedKey=null}
refreshArchiveState();setInterval(refreshArchiveState,120000);refreshStats();setInterval(refreshStats,600000);
$('#refresh').onclick=()=>refresh();$('#pause').onclick=togglePause;$('#filter').onchange=e=>{filter=e.target.value;render(true)};$('#search').oninput=e=>{query=e.target.value.trim().toLowerCase();listLimit=LIST_STEP;render(true)};refresh();setInterval(refresh,15000);
if(document.modelContext?.registerTool)document.modelContext.registerTool({name:'inspect_evidence_cases',title:'Inspect evidence cases',description:'Return structural observations for live Technocore work chains already loaded in Proofline.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','all-stages','partial','no-request','negative']}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:({status='all'}={})=>({observed_at:new Date().toISOString(),cases:cases.filter(c=>status==='all'||(status==='negative'?c.negative:c.status===status)).slice(0,20).map(c=>({room:c.room,id:c.id,status:c.status,stages:c.stages.map(s=>s.length),verdicts:c.verdicts,flags:c.flags.map(f=>f.id),records:c.list.length}))})});
