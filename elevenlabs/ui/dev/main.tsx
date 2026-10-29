import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../src/App';
import {FixtureProvider,FixtureControls,FixtureNotice,FixtureExamples,FixtureTools,FixtureSelection} from '../../../media-shared/ui/dev/FixtureSelection';
import {StudioController} from '../src/controller';
import {fixtureMedia,fixtureTransport,fixtureVoices,selectFixtureOwner} from './fixtures';
import {Price} from '../../../media-shared/ui/src';
import type {EstimateView} from '../../../media-shared/ui/src';
import '../../../media-shared/ui/src/studio.css';
import '../src/style.css';
import './theme.css';
const query=new URLSearchParams(location.search),requested=Number(query.get('width')??1280),width=[380,760,1280].includes(requested)?requested:1280;
const scenario=query.get('scenario')??'all';
document.documentElement.dataset.theme=query.get('theme')==='light'?'light':'dark';
type Control={type:'fixture-control';command:'complete'|'unknown'|'reload'|'reset'|'owner';owner?:'A'|'B'|'user'};
type Metrics={type:'fixture-metrics';width:number;innerWidth:number;clientWidth:number;scrollWidth:number;bodyWidth:number;bodyScroll:number;mobile:boolean;owner:string;submissions:number};
function PreviewHost(){
  const frame=useRef<HTMLIFrameElement>(null),[metrics,setMetrics]=useState<Metrics>();
  useEffect(()=>{const receive=(e:MessageEvent)=>{if(e.origin===location.origin&&e.source===frame.current?.contentWindow&&e.data?.type==='fixture-metrics')setMetrics(e.data);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
  const control=(command:Control['command'],owner?:Control['owner'])=>frame.current?.contentWindow?.postMessage({type:'fixture-control',command,owner} satisfies Control,location.origin);
  const inner=new URLSearchParams(query);inner.set('frame','1');
  return <><section className="fixture-controls"><strong>ElevenLabs source fixture · zero provider network · synthetic voices and quote · no native host proof</strong><p>Submission count: {metrics?.submissions??'Loading'}</p>
    <p role="status" data-testid="viewport-metrics">{metrics?`Requested ${metrics.width}px; innerWidth ${metrics.innerWidth}px; document client/scroll ${metrics.clientWidth}/${metrics.scrollWidth}px; body client/scroll ${metrics.bodyWidth}/${metrics.bodyScroll}px; mobile ${metrics.mobile}; owner ${metrics.owner}`:'Waiting for iframe viewport metrics'}</p>
    <button className="ct-btn" onClick={()=>control('complete')}>Complete job (fixture only)</button><button className="ct-btn" onClick={()=>control('unknown')}>Unknown (fixture only)</button><button className="ct-btn" onClick={()=>control('reload')}>Reload</button>
    {(['A','B','user'] as const).map(owner=><button className="ct-btn" key={owner} onClick={()=>control('owner',owner)}>View {owner}</button>)}<button className="ct-btn" onClick={()=>control('reset')}>Reset fixture</button>
    <p>Synthetic quote lifetime: 60 seconds. Playback is a locally synthesized tone, not vendor delivery.</p></section><iframe className="fixture-viewport" ref={frame} title="ElevenLabs source fixture viewport" width={width} height={900} style={{width,height:900}} src={`/?${inner}`}/></>;
}
function FixtureDocument(){
  const storageKey=`elevenlabs-ui-fixture-v1:${scenario}`;
  const [fixture]=useState(()=>fixtureTransport({scenario,load:()=>localStorage.getItem(storageKey),save:v=>localStorage.setItem(storageKey,v)}));
  const [controller]=useState(()=>new StudioController(fixture.transport));
  const [,rerender]=useState(0);
  useEffect(()=>{
    const report=()=>requestAnimationFrame(()=>{const metrics:Metrics={type:'fixture-metrics',width,innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.clientWidth,bodyScroll:document.body.scrollWidth,mobile:matchMedia('(max-width:759px)').matches,owner:fixture.owner(),submissions:fixture.submissions()};parent.postMessage(metrics,location.origin);});
    const receive=(e:MessageEvent<Control>)=>{
      if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='fixture-control')return;
      if(e.data.command==='complete')fixture.complete();else if(e.data.command==='unknown')fixture.unknown();
      else if(e.data.command==='owner'&&e.data.owner&&['A','B','user'].includes(e.data.owner))void selectFixtureOwner(fixture,controller,e.data.owner);
      else if(e.data.command==='reload')location.reload();else if(e.data.command==='reset'){localStorage.removeItem(storageKey);location.reload();}report();
    };
    const unsubscribe=controller.subscribe(()=>{rerender(n=>n+1);report();}),observer=new ResizeObserver(report);observer.observe(document.documentElement);observer.observe(document.body);window.addEventListener('message',receive);report();
    return()=>{unsubscribe();observer.disconnect();window.removeEventListener('message',receive);};
  },[controller,fixture,storageKey]);
  const base:EstimateView={gate:{kind:'ready',amount:800,unit:'usd_micro',text:'$0.0008'},count:1,capable:true,available:true,busy:false};
  const prices:EstimateView[]=[base,{...base,estimating:true},{...base,gate:{kind:'stale'}},{...base,gate:{kind:'unavailable'}},{...base,insufficient:{needs:'$0.0008',have:'$0.0004'}}];
  // The fixture follows the current DTO's ' · '-separated voice-label convention.
  return <><FixtureProvider><App ownerLabel="Rex (fixture)" controls={<FixtureControls/>} stageTools={<FixtureTools/>} fixtureNotice={<FixtureNotice/>} selection={(item,text,children)=>{const target=item.outputs[0]?.id==='fixture-local-tone'?{kind:'audio' as const,revision:'synthetic:'+fixture.owner()+':'+item.id+':tone:'+text,durationMs:4000,text,voice:item.voiceLabel.split(' · ')[0]}:undefined;return target?<FixtureSelection key={target.revision} target={target}>{children}</FixtureSelection>:children;}} controller={controller} media={fixtureMedia} voices={fixtureVoices}/><FixtureExamples/></FixtureProvider><section className="fixture-controls" aria-label="Synthetic owner controls"><strong>Synthetic fixture controls</strong><p>Owner: {fixture.owner()} · Submission count: {fixture.submissions()}</p>{(['A','B','user'] as const).map(owner=><button className="ct-btn" key={owner} onClick={()=>void selectFixtureOwner(fixture,controller,owner)}>View {owner}</button>)}</section><section className="fixture-matrix"><h2>Synthetic price states</h2>{prices.map((view,i)=><div key={i}><Price view={view} onEstimate={()=>{}} onGenerate={()=>{}}/></div>)}</section><section className="fixture-matrix" id="fixture-existing-run"><h2>Fixture existing run</h2><p>Three synthetic jobs, one failure and one waiting. No real Blueprint approval, host run or media review is represented.</p></section></>;
}
createRoot(document.getElementById('root')!).render(query.get('frame')==='1'?<FixtureDocument/>:<PreviewHost/>);
