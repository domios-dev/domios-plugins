import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, MediaPreview } from '../src/App';
import { StudioController } from '../src/controller';
import { fixtureTransport, fixtureMedia, selectFixtureOwner } from './fixtures';
import { displayUSD } from '../../src/ui';
import { Price } from '../../../media-shared/ui/src';
import type { EstimateView } from '../../../media-shared/ui/src';
import '../../../media-shared/ui/src/studio.css';
import '../src/style.css';
import './theme.css';
const query = new URLSearchParams(location.search);
const requested = Number(query.get('width') ?? 1280);
const width = [380, 760, 1280].includes(requested) ? requested : 1280;
document.documentElement.dataset.theme = query.get('theme') === 'light' ? 'light' : 'dark';
const gate = { kind: 'ready' as const, amount: 10, unit: 'usd_micro', text: displayUSD(10) };
type Command = { type: 'fixture-control'; command: 'complete' | 'unknown' | 'reload' | 'reset' | 'owner'; owner?: 'A' | 'B' | 'user' };
type Metrics = { type: 'fixture-metrics'; requested: number; innerWidth: number; clientWidth: number; scrollWidth: number;
  bodyClientWidth: number; bodyScrollWidth: number; mobile: boolean; submissions: number; owner: string };

/** Outer harness only. Width belongs to an actual nested browsing context, never body CSS. */
function PreviewHost() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [metrics, setMetrics] = useState<Metrics>();
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'fixture-metrics') setMetrics(event.data);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  const control = (command: Command['command'], owner?: Command['owner']) => {
    if (command === 'reload' || command === 'reset') setMetrics(undefined);
    frame.current?.contentWindow?.postMessage({ type: 'fixture-control', command, owner } satisfies Command, location.origin);
  };
  const innerQuery = new URLSearchParams(query); innerQuery.set('frame', '1');
  return <><section className="fixture-controls" aria-label="Fixture controls">
    <strong>Local fixture · no provider network · no native-host evidence</strong>
    <p>Submission count: {metrics?.submissions ?? 'Loading'}</p>
    <p role="status" data-testid="viewport-metrics">{metrics ? `Requested: ${metrics.requested}px; innerWidth: ${metrics.innerWidth}px; document client/scroll: ${metrics.clientWidth}/${metrics.scrollWidth}px; body client/scroll: ${metrics.bodyClientWidth}/${metrics.bodyScrollWidth}px; mobile media query: ${metrics.mobile}; owner: ${metrics.owner}` : 'Waiting for actual iframe viewport metrics…'}</p>
    <button className="ct-btn" onClick={() => control('complete')}>Complete job (fixture only)</button>
    <button className="ct-btn" onClick={() => control('unknown')}>Unknown (fixture only)</button>
    <button className="ct-btn" onClick={() => control('reload')}>Reload</button>
    {(['A', 'B', 'user'] as const).map(owner => <button className="ct-btn" key={owner} onClick={() => control('owner', owner)}>View {owner}</button>)}
    <button className="ct-btn" onClick={() => control('reset')}>Reset fixture</button>
  </section><div className="fixture-viewport"><iframe ref={frame} title="Higgsfield source fixture viewport" src={`/?${innerQuery}`} width={width} height={900} style={{ width, height: 900 }} /></div></>;
}

/** Same production App/controller below; all controls and messages remain dev-only. */
function FixtureDocument() {
  const [fixture] = useState(() => fixtureTransport({ scenario: query.get('scenario') ?? 'all', load: () => localStorage.getItem('higgs-ui-fixture-v1'), save: value => localStorage.setItem('higgs-ui-fixture-v1', value) }));
  const [controller] = useState(() => new StudioController(fixture.transport));
  const [, rerender] = useState(0);
  useEffect(() => {
    const report = () => requestAnimationFrame(() => {
      const metrics: Metrics = { type: 'fixture-metrics', requested: width, innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth,
        mobile: matchMedia('(max-width: 759px)').matches, submissions: fixture.submissions(), owner: fixture.owner() };
      window.parent.postMessage(metrics, location.origin);
    });
    const receive = (event: MessageEvent<Command>) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'fixture-control') return;
      const { command, owner } = event.data;
      if (command === 'owner' && owner && ['A', 'B', 'user'].includes(owner)) void selectFixtureOwner(fixture, controller, owner);
      else if (command === 'complete') fixture.complete();
      else if (command === 'unknown') fixture.unknown();
      else if (command === 'reset') { localStorage.removeItem('higgs-ui-fixture-v1'); location.reload(); }
      else if (command === 'reload') location.reload();
      report();
    };
    const unsubscribe = controller.subscribe(() => { rerender(n => n + 1); report(); });
    const observer = new ResizeObserver(report); observer.observe(document.documentElement); observer.observe(document.body);
    window.addEventListener('message', receive); window.addEventListener('resize', report); report();
    return () => { unsubscribe(); observer.disconnect(); window.removeEventListener('message', receive); window.removeEventListener('resize', report); };
  }, [controller, fixture]);
  const base: EstimateView = { gate, count: 1, capable: true, busy: false, available: true };
  const examples = [base, { ...base, estimating: true }, { ...base, gate: { kind: 'stale' as const } }, { ...base, gate: { kind: 'unavailable' as const } }, { ...base, insufficient: { needs: displayUSD(10), have: displayUSD(5) } }, { ...base, count: 0 }];
  return <><App controller={controller} media={fixtureMedia} /><section className="fixture-matrix" aria-label="Fixture cost states"><h2>Fixture estimate states</h2>{examples.map((view, n) => <div key={n}><Price view={view} onEstimate={() => {}} onGenerate={() => {}} /></div>)}<h2>Fixture media controls</h2><MediaPreview media={fixtureMedia.get('fixture-audio')} /></section><section id="fixture-existing-run" className="fixture-matrix"><h2>Fixture existing run</h2><p>One run, three jobs, one failure; waiting is synthetic. Host approval and run navigation remain unproven.</p></section></>;
}
createRoot(document.getElementById('root')!).render(query.get('frame') === '1' ? <FixtureDocument /> : <PreviewHost />);
