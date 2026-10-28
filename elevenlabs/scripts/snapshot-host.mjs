// Read immutable git objects only. Does not inspect credentials or installed state.
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const repo='C:/Developer/codeterm/codeterm';
const sha='5ef813c0227e18d4082568068e29b1bbc3e34ed8';
const paths=[
 'packages/plugin-sdk/package.json','packages/plugin-sdk/src/host.ts','packages/plugin-sdk/src/capabilities.ts','packages/plugin-sdk/src/mediaDelivery.ts',
 'src/components/Extensions/PluginView.tsx','src/components/Extensions/usePluginDocument.ts','src/lib/pluginDocument.ts','src/lib/surfaceTab.ts','src/lib/surfaceActivity.ts','src/lib/surfaceInvalidation.ts','src/lib/pluginViewHostActions.ts','src/lib/pluginViewHostDeps.ts',
 'src-tauri/crates/codeterm-service-core/src/service/surface/ops.rs','src-tauri/crates/codeterm-service-core/src/service/surface/model.rs','src-tauri/crates/codeterm-service-core/src/service/surface/agent_call.rs','src-tauri/crates/codeterm-service-core/src/service/surface/view.rs','src-tauri/crates/codeterm-service-core/src/service/surface/activity.rs','src-tauri/crates/codeterm-service-core/src/service/plugin_host.rs',
 'src-tauri/crates/codeterm-plugin/src/js_runtime/host_surface.rs','src-tauri/crates/codeterm-plugin/src/js_runtime/view.rs','src-tauri/crates/codeterm-plugin/src/js_runtime/host_api.rs','src-tauri/crates/codeterm-plugin/src/js_runtime/host_net.rs','src-tauri/crates/codeterm-plugin/src/js_runtime/transcriber.rs','src-tauri/crates/codeterm-plugin/src/js_runtime/manifest/graph_nodes.rs','src-tauri/crates/codeterm-plugin/src/js_runtime/parity_test/media_delivery.rs',
 'src-tauri/crates/codeterm-plugin/src/media_delivery.rs','src-tauri/crates/codeterm-plugin/src/media_delivery/format.rs','src-tauri/crates/codeterm-plugin/src/view_host.rs',
 'src-tauri/crates/codeterm-api/src/plugin_media_routes.rs','src-tauri/crates/codeterm-api/src/web_plugin_routes.rs','src-tauri/crates/codeterm-commands/src/commands/plugins/view.rs','src-tauri/crates/codeterm-api/src/plugin_host_action_routes.rs','src-tauri/crates/codeterm-commands/src/commands/plugins/host_action.rs','src-tauri/crates/codeterm-service-core/src/plugin_media.rs',
 'src-tauri/crates/codeterm-blueprint-types/src/code_source.rs','src-tauri/crates/codeterm-blueprint-types/src/code_source/windows.rs',
 'src-tauri/crates/codeterm-bridge/src/chatpipeline/mod.rs','src-tauri/crates/codeterm-config/src/lib.rs',
 'packages/chat-core/src/localArtifactDirective.ts','packages/chat-ui/src/LocalImageGallery.tsx','packages/chat-ui/src/localArtifactLoader.ts',
 'docs/architecture/plugin-media-delivery.md','prod-docs/SURFACES.md','prod-docs/BLUEPRINTS.md','prod-docs/INTEGRATIONS.md','plugins/browser/BROWSER.md','plugins/browser/plugin.json','plugins/browser/src/plugin.ts',
];
const files=paths.map(path=>{
 const text=execFileSync('git',['-C',repo,'show',sha+':'+path],{encoding:'utf8',maxBuffer:2*1024*1024});
 return {path,sha256:createHash('sha256').update(text).digest('hex'),text};
});
const pluginSha='5c473f057b8d94f8b63f003f81b42f7831932800';
for(const path of ['transcriber/plugin.json','transcriber/src/plugin.ts','transcriber/settings.schema.json']){
 const text=execFileSync('git',['show',pluginSha+':'+path],{encoding:'utf8'});
 files.push({path,repository:'codeterm-plugins',commit:pluginSha,sha256:createHash('sha256').update(text).digest('hex'),text});
}
const ancestry={};
for(const candidate of ['05f2fec6e2d6e879e6e1e4f7c097852f8eb2d28b','bd074a0bfae0fc6a11d92a96f6aa8ad67723e836','317d6b3e07cdf63336e16c3389d9c5acb49c801f']){
 try{execFileSync('git',['-C',repo,'merge-base','--is-ancestor',candidate,sha]);ancestry[candidate]='ancestor';}catch{ancestry[candidate]='not-proven';}
}
await writeFile(new URL('../evidence/host-source.json',import.meta.url),JSON.stringify({snapshot_date:'2026-10-29',repository:'https://github.com/domios-dev/domios',commit:sha,status:'merged-source-snapshot; release/runtime/minimum-host NOT established',ancestry,files},null,2)+'\n');
console.log(JSON.stringify({commit:sha,files:files.length,ancestry}));
