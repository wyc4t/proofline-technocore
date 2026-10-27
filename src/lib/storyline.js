import {attestationTargetText} from './cases.js';

// Presentation only: relationships come from verified-key comparisons and checked
// hash targets. Stage order is never used to infer a connection.
export function storylineModel(c) {
  const resultLabel=seq=>`result #${seq}`;
  return c.stages.map((records,stage)=>({stage,records:records.map(record=>{
    const target=c.attestationDetails.find(a=>a.seq===record.seq);
    const namedBy=c.attestationDetails.filter(a=>a.state==='matched'&&a.matches.includes(record.seq));
    const conflict=c.conflicts.find(g=>g.results.includes(record.seq));
    const sameKey=c.links.filter(l=>l.type==='same-key'&&(l.from===record.seq||l.to===record.seq));
    const success=stage===0?/\bSuccess\s*:\s*([\s\S]*)/i.exec(record.body)?.[1]?.trim():null;
    const relations=[];
    if(target)relations.push(target.state==='unnamed'?`${target.kind} #${target.seq} names no result by hash.`:attestationTargetText(target));
    if(stage===2)relations.push(namedBy.length?`Named by ${namedBy.map(a=>`#${a.seq} (${a.verdict==='not'?'negative':a.verdict} claim)`).join(', ')} by hash.`:'No attestation in these records names this result by a checked hash.');
    if(sameKey.length)relations.push(`Same verified key as ${sameKey.map(link=>{const other=link.from===record.seq?link.to:link.from;return link.from===record.seq?resultLabel(other):`worker #${other}`}).join(', ')}.`);
    const citations=c.links.filter(l=>l.type==='cites'&&l.from===record.seq);if(citations.length)relations.push(`Text cites ${citations.map(l=>'#'+l.to).join(', ')}; a citation alone does not verify a relationship.`);
    return {record,stage,target,namedBy,conflict,sameKey,success,relations,echo:c.flags.some(f=>f.id==='wording-from-request'&&f.seqs.includes(record.seq))};
  })}));
}
export function storylineLinks(c) {
  return c.links.filter(l=>l.type==='same-key'||l.type==='hash'&&c.attestationDetails.some(a=>a.seq===l.from&&a.state==='matched'&&a.matches.includes(l.to)));
}
export function storyPreview(text,limit=300) {
  const raw=String(text||'');return {text:raw.length>limit?raw.slice(0,limit).trimEnd()+'…':raw,truncated:raw.length>limit};
}
export function mountStoryline(host,c,{onSelect,expanded=new Set()}={}) {
  const doc=host.ownerDocument,make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n};
  host.replaceChildren();host.className='storyline';host.setAttribute('aria-label','Case storyline: columns are stages, not causes');
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');svg.classList.add('story-links');svg.setAttribute('aria-hidden','true');host.append(svg);
  const labels=['Request','Worker','Result','Attestation'];
  for(const group of storylineModel(c)){
    const section=make('section',`story-column stage-${group.stage}`),heading=make('h3','',`${labels[group.stage]} · ${group.records.length}`),body=make('div','story-records');section.setAttribute('aria-label',`${labels[group.stage]} records`);section.append(heading,body);host.append(section);
    const appendCard=item=>{
      const {record:r,stage,target,relations,conflict,success,echo}=item,card=make('button',`story-card${stage===1?' worker-chip':''}${conflict?' has-conflict':''}`);card.type='button';card.dataset.record=String(r.seq);card.setAttribute('aria-haspopup','dialog');
      card.append(make('span','story-record-id',`${r.kind} #${r.seq}`));
      if(stage===3)card.append(make('span','story-verdict',`${r.verdict==='useful'?'U · Useful':r.verdict==='not'?'N · Negative':`? · ${r.verdict}`} · claim`));
      if(conflict)card.append(make('span','story-conflict',`${conflict.useful.length+conflict.negative.length} opposite verdict claims · same text`));
      const content=stage===1?null:stage===0?(r.kind==='JOB'?r.text.split('|')[3]?.trim():r.body)||r.body:stage===3?r.body.replace(/^rh:[0-9a-f]{16,64}\s*\|\s*/i,''):r.body;
      if(content){const preview=storyPreview(content,stage===0?240:300);card.append(make('span','story-text',preview.text));if(preview.truncated)card.append(make('span','story-full','Excerpt · open full source ↗'))}
      if(success)card.append(make('span','story-success',`SUCCESS LINE\n${storyPreview(success,200).text}`));
      if(echo)card.append(make('span','story-pattern','Pattern: wording almost entirely from the request.'));
      for(const relation of relations){const readable=target?.state==='matched'&&relation===relations[0]?`Names ${target.matches.length===1?'result':'identical result text at'} ${target.matches.map(n=>'#'+n).join(', ')} by hash.`:relation;const p=storyPreview(readable,180);card.append(make('span',target?.state==='matched'?'story-relation hash-match':'story-relation',p.text));if(p.truncated)card.append(make('span','story-full','Open source for all connections ↗'))}
      const t=Date.parse(r.ts),first=Date.parse(c.stages[0][0]?.ts),dt=Number.isFinite(t)&&Number.isFinite(first)?Math.round((t-first)/1000):null;
      card.append(make('span','story-time',`${r.sigStatus==='valid'?'Signature verified':r.sigStatus==='invalid'?'SIGNATURE FAILS':r.sigStatus==='no_sig'?'No signature':r.sigStatus==='unchecked'?'Signature unchecked':'Self-asserted sender'}${stage===2&&dt!==null?` · venue ${dt<0?'time order invalid':`+${dt} s`}`:''}`));
      card.onclick=()=>onSelect(r.seq);body.append(card);
    };
    if(!group.records.length)body.append(make('p','story-absent','Not seen in these records. May be outside this window, not yet posted, or absent.'));
    const limit=expanded.has(group.stage)?group.records.length:3;group.records.slice(0,limit).forEach(appendCard);
    if(group.records.length>3){
      const more=make('button','story-more');more.type='button';
      const label=()=>{const full=expanded.has(group.stage);more.textContent=full?`Show first 3 ${labels[group.stage].toLowerCase()} records`:`Show all ${group.records.length} ${labels[group.stage].toLowerCase()} records (${group.records.length-3} more)`;more.setAttribute('aria-expanded',String(full))};label();
      more.onclick=()=>{if(expanded.has(group.stage)){expanded.delete(group.stage);[...body.querySelectorAll('.story-card')].slice(3).forEach(n=>n.remove());body.append(more);label();more.focus()}else{expanded.add(group.stage);group.records.slice(3).forEach(appendCard);body.append(more);label();body.querySelectorAll('.story-card')[3]?.focus()}schedule()};body.append(more);
    }
  }
  function draw(){
    svg.replaceChildren();if(!host.isConnected||host.clientWidth<900)return;
    const box=host.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    for(const link of storylineLinks(c)){
      let a=host.querySelector(`[data-record="${link.from}"]`),b=host.querySelector(`[data-record="${link.to}"]`);if(!a||!b)continue;
      let ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();if(ar.left>br.left)[ar,br]=[br,ar];
      const x=ar.right-box.left,y=ar.top+ar.height/2-box.top,x2=br.left-box.left,y2=br.top+br.height/2-box.top,path=doc.createElementNS(ns,'path');
      path.setAttribute('d',`M${x},${y} C${(x+x2)/2},${y} ${(x+x2)/2},${y2} ${x2},${y2}`);path.setAttribute('class',link.type==='hash'?'hash-line':'key-line');svg.append(path);
    }
  }
  let frame;const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw)};
  const observer=new ResizeObserver(schedule);observer.observe(host);schedule();
  return ()=>{observer.disconnect();cancelAnimationFrame(frame)};
}
