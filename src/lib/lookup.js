import {digest,parsePin,formatPin} from './snapshot.js';
export async function lookupCase({room,id,base,fetchText}){
 if(!['credence','kibble'].includes(room)||!/^[\w-]{1,64}$/.test(id))throw Error('Choose a supported room and a job ID of 1–64 letters, digits, underscores or hyphens.');
 const status=JSON.parse(await fetchText(`${base}lookup/${room}/status.json`));
 if(status.format!=='proofline-lookup'||status.version!==1||status.room!==room)throw Error('Unsupported archive lookup index');
 const bucket=(await digest(new TextEncoder().encode(id))).slice(0,2);
 const text=await fetchText(`${base}lookup/${room}/${bucket}.json`,{allowMissing:true});
 if(text===null&&status.shards?.includes(bucket))throw Error('Archive lookup shard unavailable');
 const shard=text===null?null:JSON.parse(text);
 if(shard&&(shard.format!=='proofline-lookup-shard'||shard.version!==1||shard.room!==room||!Array.isArray(shard.entries)))throw Error('Invalid archive lookup shard');
 const candidates=(shard?.entries||[]).filter(e=>e.id===id).map(e=>{
   const pin=formatPin(e.generation,e.first,e.last);
   if(!parsePin(pin)||!Number.isSafeInteger(e.records)||e.records<1)throw Error('Invalid candidate range in archive lookup');
   return {...e,pin,key:`${room}:${id}`,ambiguous:status.reused_generations?.includes(e.generation)||false};
 });
 return {status,candidates};
}
