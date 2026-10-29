import React,{useEffect,useState} from 'react';
type Bounds={clientWidth:number;scrollWidth:number;left:number;right:number;width:number};
type Metrics={innerWidth:number;main:Bounds|null;stage:Bounds|null};
/** Passive numeric layout proof. DEV entry only, outside the App crop; never reads content. */
export function SyntheticAppMetrics(){
  const [metrics,setMetrics]=useState<Metrics>();
  useEffect(()=>{
    let frame=0;
    const read=(node:Element|null):Bounds|null=>{if(!node)return null;const rect=node.getBoundingClientRect();return {clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,left:rect.left,right:rect.right,width:rect.width};};
    const measure=()=>{frame=0;const next={innerWidth:window.innerWidth,main:read(document.querySelector('main.studio')),stage:read(document.querySelector('main.studio .studio-stage-content'))};setMetrics(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);};
    const queue=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const main=document.querySelector('main.studio'),stage=main?.querySelector('.studio-stage-content');
    const resize=new ResizeObserver(queue);if(main)resize.observe(main);if(stage)resize.observe(stage);
    const mutations=new MutationObserver(queue);if(main)mutations.observe(main,{subtree:true,childList:true,attributes:true,characterData:true});
    window.addEventListener('resize',queue);queue();
    return()=>{resize.disconnect();mutations.disconnect();window.removeEventListener('resize',queue);if(frame)cancelAnimationFrame(frame);};
  },[]);
  return <section className="fixture-controls" aria-label="Synthetic App metrics"><strong>Synthetic App metrics · passive numeric bounds only</strong><output data-testid="synthetic-app-metrics">{metrics?JSON.stringify(metrics):'Measuring App bounds'}</output></section>;
}
