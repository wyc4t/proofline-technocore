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
  const raw=String(text||'');return {text:raw.length>limit?raw.slice(0,limit-1).trimEnd()+'…':raw,truncated:raw.length>limit};
}
export function caseBadgeLabels(c){const count=c.stages.filter(s=>s.length).length;return [count===4?'ALL 4 STAGES':`${count} OF 4 STAGES OBSERVED`,...(c.conflicts.length?['CONFLICTING VERDICTS']:[])]}
export function resultStatus(item){return item.conflict?`${item.conflict.useful.length+item.conflict.negative.length} OPPOSITE VERDICTS`:item.namedBy.length?`Named by ${item.namedBy.length} attestation${item.namedBy.length===1?'':'s'}`:'No attestation names this result'}
export function hiddenConnectionCount(c,stage,limit=3){const hidden=new Set(c.stages[stage].slice(limit).map(r=>r.seq));return storylineLinks(c).filter(l=>hidden.has(l.from)||hidden.has(l.to)).length}
export function mountStoryline(host,c,{onSelect,expanded=new Set(),highlight=[],guided=false}={}) {
  const doc=host.ownerDocument,make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n};
  host.replaceChildren();host.className='storyline';host.setAttribute('aria-label','Case storyline: columns are stages, not causes');
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');svg.classList.add('story-links');svg.setAttribute('aria-hidden','true');host.append(svg);
  const labels=['Request','Worker','Result','Attestation'];
  for(const group of storylineModel(c)){
    const section=make('section',`story-column stage-${group.stage}`),heading=make('h3','',`${labels[group.stage]} · ${group.records.length}`),body=make('div','story-records');section.setAttribute('aria-label',`${labels[group.stage]} records`);section.append(heading,body);host.append(section);
    const appendCard=item=>{
      const {record:r,stage,target,relations,conflict,success,echo}=item,card=make('button',`story-card${stage===1?' worker-chip':''}${conflict?' has-conflict':''}${guided&&highlight.includes(r.seq)?' guide-highlight':''}`);card.type='button';card.dataset.record=String(r.seq);card.setAttribute('aria-haspopup','dialog');card.title=relations.join(' ');
      const pattern=c.flags.some(f=>f.seqs.includes(r.seq)),id=make('span','story-record-id',`${r.kind} #${r.seq}${r.sigStatus==='invalid'?' · SIGNATURE FAILS':''}`);
      if(stage===1){id.textContent+=item.sameKey.length?' · same key as '+item.sameKey.map(l=>'result #'+l.to).join(', '):'';card.append(id)}else{
        if(stage===2&&pattern)id.append(make('small','pattern-tag','Pattern'));card.append(id);
        if(stage===3)card.append(make('span','story-verdict',`${r.verdict==='useful'?'U · Useful':r.verdict==='not'?'N · Negative':`? · ${r.verdict}`} · claim`));
        const raw=stage===0?(r.text.split('|')[3]?.trim()||r.body):stage===3?r.body.replace(/^rh:[0-9a-f]{16,64}\s*\|\s*/i,''):r.body;
        const preview=storyPreview(raw,stage===0?160:140),text=make('span','story-text',preview.text);if(preview.truncated)text.append(make('small','story-full','Excerpt · open source'));card.append(text);
        if(stage===0&&success){const p=storyPreview(success,160),line=make('span','story-success','SUCCESS LINE\n'+p.text);if(p.truncated)line.append(make('small','story-full','Excerpt · open source'));card.append(line)}
        if(stage===2)card.append(make('span',conflict?'story-conflict':'story-relation',resultStatus(item)));
        if(stage===3){const label=target?.state==='matched'?`Names ${target.matches.length===1?'result':'identical text at'} ${target.matches.map(n=>'#'+n).join(', ')} by hash`:target?.state==='unnamed'?'Names no result by hash':target?.state==='ambiguous'?'Target ambiguous · open source':target?.state==='unchecked'?'Target not checked · open source':'Target not in these records';card.append(make('span',target?.state==='matched'?'story-relation hash-match':'story-relation',label))}
      }
      card.onclick=()=>onSelect(r.seq);body.append(card);
    };
    if(!group.records.length)body.append(make('p','story-absent','Not seen in these records. May be outside this window, not yet posted, or absent.'));
    const limit=expanded.has(group.stage)?group.records.length:3;group.records.slice(0,limit).forEach(appendCard);
    if(group.records.length>3){
      const more=make('button','story-more');more.type='button';
      const label=()=>{const full=expanded.has(group.stage);more.textContent=full?`Show first 3 ${labels[group.stage].toLowerCase()} records`:`Show all ${group.records.length} ${labels[group.stage].toLowerCase()} records (${group.records.length-3} more)`;more.setAttribute('aria-expanded',String(full));const notice=section.querySelector('.hidden-connections');if(notice)notice.hidden=full};label();
      more.onclick=()=>{if(expanded.has(group.stage)){expanded.delete(group.stage);[...body.querySelectorAll('.story-card')].slice(3).forEach(n=>n.remove());body.append(more);label();more.focus()}else{expanded.add(group.stage);group.records.slice(3).forEach(appendCard);body.append(more);label();body.querySelectorAll('.story-card')[3]?.focus()}schedule()};body.append(more);const count=hiddenConnectionCount(c,group.stage);if(count){const notice=make('p','hidden-connections',`${count} connections go to records hidden here · `),show=make('button','','Show all');show.type='button';show.onclick=()=>more.click();notice.append(show);notice.hidden=expanded.has(group.stage);section.append(notice)}
    }
  }
  function draw(){
    svg.replaceChildren();if(!host.isConnected||host.clientWidth<900)return;
    const box=host.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    for(const link of storylineLinks(c)){
      let a=host.querySelector(`[data-record="${link.from}"]`),b=host.querySelector(`[data-record="${link.to}"]`);if(!a||!b)continue;
      let ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();if(ar.left>br.left)[ar,br]=[br,ar];
      const leftHeader=(ar.left===a.getBoundingClientRect().left?a:b).querySelector('.story-record-id').getBoundingClientRect(),rightHeader=(ar.left===a.getBoundingClientRect().left?b:a).querySelector('.story-record-id').getBoundingClientRect();const x=ar.right-box.left,y=leftHeader.top+leftHeader.height/2-box.top,x2=br.left-box.left,y2=rightHeader.top+rightHeader.height/2-box.top,path=doc.createElementNS(ns,'path');
      path.setAttribute('d',`M${x},${y} C${(x+x2)/2},${y} ${(x+x2)/2},${y2} ${x2},${y2}`);path.setAttribute('class',link.type==='hash'?'hash-line':'key-line');svg.append(path);
    }
  }
  let frame;const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw)};
  const observer=new ResizeObserver(schedule);observer.observe(host);schedule();
  return ()=>{observer.disconnect();cancelAnimationFrame(frame)};
}
