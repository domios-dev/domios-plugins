import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ptr=(root,path)=>path.split('/').slice(1).reduce((v,k)=>{
  k=k.replaceAll('~1','/').replaceAll('~0','~');assert.ok(v&&Object.hasOwn(v,k),'schema hole '+path);return v[k];
},root);
const exact=(value,allowed)=>assert.ok(value&&Object.keys(value).every(k=>allowed.includes(k)),'unknown field/unsupported claim');
const ids=(rows,label)=>{assert.ok(rows.every(r=>typeof r.id==='string'&&r.id.length),label+' missing id');assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,label+' duplicate id');};
export function checkDescriptors(manifest) {
  const steps=manifest.capabilities.graphNodes.steps;
  assert.ok(steps.length>0&&steps.length<=32,'step bound');ids(steps,'steps');
  for(const step of steps){
    exact(step,['contractVersion','revision','id','title','description','params','inputs','outputs','outcomes','lifecycle','effects']);
    assert.equal(step.contractVersion,1);assert.equal(step.revision,1);
    assert.match(step.id,/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    assert.equal(step.params.type,'object');exact(step.params,['type','properties','required']);
    for(const key of step.params.required??[])assert.ok(Object.hasOwn(step.params.properties,key),'missing required type');
    for(const property of Object.values(step.params.properties)){
      exact(property,['type','enum','maxLength','items','maxItems','description']);
      assert.ok(['string','integer','number','boolean','array'].includes(property.type),'bad type');
      if(property.type==='string')assert.ok(Number.isInteger(property.maxLength)&&property.maxLength<=65536);
      if(property.type==='array'){assert.ok(Number.isInteger(property.maxItems)&&property.maxItems<=256);assert.ok(['string','integer','number','boolean'].includes(property.items?.type));}
    }
    assert.deepEqual(step.outcomes,['succeeded','failed','canceled','unknown'],'unknown outcome');
    assert.deepEqual(step.lifecycle,{reconcile:false,cancel:false},'unsupported lifecycle claim');
    assert.deepEqual(step.effects,{sideEffects:true,potentiallyPaid:true});
    for(const port of Object.values({...step.inputs,...step.outputs})){
      exact(port,['kind','minItems','maxItems','schema']);assert.ok(['text','json','image','audio','video','file'].includes(port.kind));
      assert.ok(Number.isInteger(port.minItems)&&Number.isInteger(port.maxItems)&&port.minItems>=0&&port.maxItems>=port.minItems&&port.maxItems<=64);
    }
  }
  assert.equal(manifest.capabilities.surfaces[0].agentBound,true);
  assert.equal(manifest.capabilities.surfaces[0].stateInvalidation,true);
  const verbs=manifest.capabilities.surfaces[0].agentVerbs;
  assert.ok(verbs.length<=32&&new Set(verbs).size===verbs.length&&verbs.every(v=>/^[a-z][a-z0-9-]{0,31}$/.test(v)));
}
export function checkCoverage(coverage,caps,models,manifest,spec,protocols) {
  checkDescriptors(manifest);
  const sources=new Map(caps.sources.map(s=>[s.id,s]));
  const sourced=s=>{const src=sources.get(s.source_id);assert.ok(src,'absent source');assert.equal(s.url,src.url);assert.match(s.retrieved_at,/^2026-10-(28|29)/);};
  const expectedOperations=[];
  for(const item of Object.values(spec.paths))for(const [method,op] of Object.entries(item))if(['get','post','put','patch','delete','head','options'].includes(method))expectedOperations.push(op.operationId);
  assert.deepEqual(caps.operations.filter(o=>o.id_origin==='vendor-openapi-operationId').map(o=>o.id).sort(),expectedOperations.sort(),'missing normative operation');
  for(const [name,base,file] of [['operations',caps.operations,'capabilities.json'],['models',models.models,'models.json'],['display',models.catalog_display_models,'models.json']]) {
    ids(coverage[name],name);assert.deepEqual(coverage[name].map(r=>r.id),base.map(r=>r.id),'missing/foreign '+name);
    for(let i=0;i<base.length;i++){
      const row=coverage[name][i],source=base[i];
      exact(row,name==='operations'?['id','evidence','sources','schema','command','blueprint','docs','ui']:name==='models'?['id','evidence','sources','command','blueprint','docs']:['id','evidence','sources','command','limitation','docs']);
      assert.deepEqual(row.sources,source.sources);row.sources.forEach(sourced);
      assert.deepEqual(row.evidence,{file,pointer:'/'+(name==='display'?'catalog_display_models':name)+'/'+i,sha256:hash(source)},'changed source/schema/default/limit/unsupported claim');
      assert.equal(row.docs,source.sources[0].url);
      if(name==='operations'){
        assert.deepEqual(row.command,{verb:'describe',body:{operation:row.id}});
        exact(row.blueprint,['node','operation','limitation']);
        assert.equal(row.schema,source.schema.format+':'+source.schema.source_id+'#'+source.schema.pointer);
        assert.equal(row.blueprint.node,'elevenlabs.'+source.family.replaceAll('-','_'));
        assert.equal(row.blueprint.operation,row.id);assert.match(row.blueprint.limitation,/discovery only.*refuses execution/);
        assert.ok(manifest.capabilities.graphNodes.steps.find(s=>s.id===row.blueprint.node)?.params.properties.operation.enum.includes(row.id),'missing descriptor operation');
        for(const field of ['availability','authorization','transport','lifecycle','cost']) {assert.ok(source[field]);sourced(source[field].source);}
        assert.ok(source.schema.defaults_and_limits&&source.authorization.owner_policy&&source.availability.account_entitlement);
        for(const field of ['cancel','progress','preview','reconcile'])assert.ok(source.lifecycle[field]);
        assert.equal(source.cost.safe_estimate.status,'not-established');
        if(source.schema.format==='openapi')assert.equal(ptr(spec,source.schema.pointer).operationId,source.id);
        else assert.ok(protocols.documents.some(d=>d.source_id===source.schema.source_id));
      } else {
        assert.deepEqual(row.command,{verb:'models'});
        if(name==='display')assert.equal(row.limitation,source.availability.limitation);
        else {assert.ok(row.blueprint.limitation);if(row.blueprint.node)assert.ok(manifest.capabilities.graphNodes.steps.some(s=>s.id===row.blueprint.node));}
      }
    }
  }
  assert.deepEqual(coverage.unresolved,models.unresolved_catalogs,'omitted unresolved catalog');
  // Resolve every transitive reference; there is no schema-hole escape through a source hash.
  const refs=(v,doc)=>{if(!v||typeof v!=='object')return;if(v.$ref){assert.ok(v.$ref.startsWith('#/'));ptr(doc,v.$ref.slice(1));}Object.values(v).forEach(x=>refs(x,doc));};
  refs(spec,spec);protocols.documents.forEach(d=>refs(d.spec,d.spec));
}
export async function inputs(){return Promise.all(['coverage.json','capabilities.json','models.json','plugin.json','evidence/openapi.json','evidence/asyncapi.json'].map(json));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const data=await inputs();checkCoverage(...data);
  const removed=structuredClone(data);removed[0].operations.pop();assert.throws(()=>checkCoverage(...removed),/missing\/foreign/);
  const badType=structuredClone(data);badType[3].capabilities.graphNodes.steps[0].params.properties.operation.type='secret';assert.throws(()=>checkCoverage(...badType),/bad type/);
  const badOutcome=structuredClone(data);badOutcome[3].capabilities.graphNodes.steps[0].outcomes.push('paid-retry');assert.throws(()=>checkCoverage(...badOutcome),/unknown outcome/);
  console.log(`PASS coverage: ${data[0].operations.length} operations, ${data[0].models.length} selectors, ${data[0].display.length} display variants; 3 negative oracles rejected. Source only; runtime UNRUN.`);
}
