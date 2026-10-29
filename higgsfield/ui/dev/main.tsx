import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, MediaPreview } from '../src/App';
import { StudioController } from '../src/controller';
import { fixtureTransport, fixtureMedia } from './fixtures';
import { Price } from '../../../media-shared/ui/src';
import type { EstimateView } from '../../../media-shared/ui/src';
import '../../../media-shared/ui/src/studio.css';
import '../src/style.css';
import './theme.css';
const query = new URLSearchParams(location.search);
const width = Number(query.get('width') ?? 1280);
document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.body.style.width = `${[380, 760, 1280].includes(width) ? width : 1280}px`;
const fixture = fixtureTransport({ scenario: query.get('scenario') ?? 'all', load: () => localStorage.getItem('higgs-ui-fixture-v1'), save: value => localStorage.setItem('higgs-ui-fixture-v1', value) });
const controller = new StudioController(fixture.transport);
const gate = { kind: 'ready' as const, amount: 10, unit: 'usd_micro', text: '10 microdollars' };
function Preview() {
  const [, rerender] = useState(0);
  useEffect(() => controller.subscribe(() => rerender(n => n + 1)), []);
  const base: EstimateView = { gate, count: 1, capable: true, busy: false, available: true };
  const examples = [base, { ...base, estimating: true }, { ...base, gate: { kind: 'stale' as const } }, { ...base, gate: { kind: 'unavailable' as const } }, { ...base, insufficient: { needs: '10 microdollars', have: '5 microdollars' } }, { ...base, count: 0 }];
  return <><div className="fixture-controls"><strong>Local fixture · no provider network · no native-host evidence</strong><p>Submission count: {fixture.submissions()}</p><p>CSS width: {document.body.style.width}; theme: {document.documentElement.dataset.theme}</p><button onClick={() => fixture.complete()}>Complete job (fixture only)</button><button onClick={() => fixture.unknown()}>Unknown (fixture only)</button><button onClick={() => location.reload()}>Reload</button>{['A', 'B', 'user'].map(owner => <button key={owner} onClick={() => { fixture.setOwner(owner as 'A'); void controller.selectModel('higgsfield-ai/soul/v2/standard'); rerender(n => n + 1); }}>View {owner}</button>)}<button onClick={() => { localStorage.removeItem('higgs-ui-fixture-v1'); location.reload(); }}>Reset fixture</button></div><App controller={controller} media={fixtureMedia} fixtureLabel="Fixture" /><section className="fixture-matrix" aria-label="Fixture cost states"><h2>Fixture estimate states</h2>{examples.map((view, n) => <div key={n}><Price view={view} onEstimate={() => {}} onGenerate={() => {}} /></div>)}<h2>Fixture media controls</h2><MediaPreview media={fixtureMedia.get('fixture-audio')} /></section><section id="fixture-existing-run" className="fixture-matrix"><h2>Fixture existing run</h2><p>One run, three jobs, one failure; waiting is synthetic. Host approval and run navigation remain unproven.</p></section></>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
