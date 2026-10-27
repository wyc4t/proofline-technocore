// Record-frequency context, scoped to one room. Text equality is lexical, never a quality verdict.
export const normalizedBody = value => String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
export function textFrequencies(records,stage){
 const counts=new Map();let total=0;
 for(const r of records)if(r.stage===stage){total++;const t=normalizedBody(r.body);if(t.length>=12)counts.set(t,(counts.get(t)||0)+1)}
 return {records:total,counts};
}
export function textPopulation(records,stage){
 const {records:total,counts}=textFrequencies(records,stage);
 let top=null;for(const [text,count] of counts)if(!top||count>top.records)top={text,records:count,share_pct:total?Math.round(count*1000/total)/10:null};
 return {records:total,top};
}
export function roomPopulation(records){
 return {results:textPopulation(records,2),attestations:textPopulation(records,3)};
}
