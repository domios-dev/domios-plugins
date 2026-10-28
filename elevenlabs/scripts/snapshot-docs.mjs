// Public documentation only. No credentials, vendor account calls, or retries.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = new URL('../evidence/', import.meta.url);
const index = await readFile(new URL('llms.txt', root), 'utf8');
const all = [...index.matchAll(/\[([^\]]+)\]\((https:\/\/elevenlabs\.io\/[^)]+)\)/g)].map(m => ({title:m[1],url:m[2]}));
const urls = [...new Map(all.filter(x => /\/api-reference\//.test(x.url) || /\/overview\//.test(x.url) || /websockets\//.test(x.url)).map(x => [x.url,x])).values()];
await mkdir(new URL('pages/',root),{recursive:true});
const records=[];
let cursor=0;
await Promise.all(Array.from({length:8},async()=>{
  while(cursor<urls.length){
    const entry=urls[cursor++];
    const file='pages/'+createHash('sha256').update(entry.url).digest('hex').slice(0,20)+'.md';
    try {
      const r=await fetch(entry.url,{signal:AbortSignal.timeout(25000)});
      const body=await r.text();
      const valid=r.ok && !/^\s*<!doctype html/i.test(body);
      if(valid) await writeFile(new URL(file,root),body);
      records.push({...entry,retrieved_at:new Date().toISOString(),status:r.status,valid,file:valid?file:null,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')});
    } catch(e) {records.push({...entry,retrieved_at:new Date().toISOString(),valid:false,error:String(e)});}
  }
}));
records.sort((a,b)=>a.url.localeCompare(b.url));
await writeFile(new URL('page-manifest.json',root),JSON.stringify(records,null,2)+'\n');
console.log(JSON.stringify({total:records.length,saved:records.filter(x=>x.valid).length,failed:records.filter(x=>!x.valid)}));
