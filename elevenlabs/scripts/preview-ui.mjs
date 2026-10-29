// Parent-owned lightweight source preview. Never a worker build or production entry.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),port=args[0]==='--port'&&/^\d{4,5}$/.test(args[1]??'')?Number(args[1]):4180;
const bundle=await build({absWorkingDir:fileURLToPath(new URL('../../',import.meta.url)),entryPoints:['elevenlabs/ui/dev/main.tsx'],bundle:true,write:false,outdir:'fixture-output',format:'esm',platform:'browser'});
const files=new Map(bundle.outputFiles.map(f=>[f.path.endsWith('.css')?'/app.css':'/app.js',f.contents]));
// Real audible PCM fixture, synthesized locally. No provider bytes, URLs or generated result claim.
const rate=16000,seconds=4,samples=rate*seconds,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let n=0;n<samples;n++){const envelope=Math.min(1,n/800,(samples-n)/800);wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*n/rate)*5000*envelope),44+n*2);}
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ElevenLabs source fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
createServer((req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;res.setHeader('Cache-Control','no-store');
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);}
  else if(files.has(path)){res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(files.get(path));}
  else if(path==='/fixtures/tone.wav'){
    res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
    if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
      if(start>end||start>=wav.length){res.writeHead(416,{'Content-Range':`bytes */${wav.length}`});res.end();return;}
      res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Content-Length':end-start+1});res.end(wav.subarray(start,end+1));
    }else{res.setHeader('Content-Length',wav.length);res.end(wav);}
  }else{res.statusCode=404;res.end();}
}).listen(port,'127.0.0.1',()=>process.stdout.write(`Source fixture only: http://127.0.0.1:${port}\n`));
