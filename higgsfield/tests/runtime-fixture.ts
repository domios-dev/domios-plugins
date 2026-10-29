import { createHash } from 'node:crypto';
import type { Host } from '@codeterm/plugin-sdk';
export function fakeHost() {
  const files = new Map<string, string>();
  let locked = false;
  const forbidden = () => { throw new Error('network_or_secret_must_not_be_used'); };
  const host = { dataDir: () => '/isolated', unixNowMs: () => 100,
    md5: (s: string) => createHash('md5').update(s).digest('hex'),
    secretGet: forbidden, fetch: forbidden, transfer: { start: forbidden },
    surface: { dispatch: (verb: string, args: string[]) => ({ result: JSON.stringify({ verb, args }) }), invalidate: () => ({ ok: true }) },
    fs: { makeDirs: () => true, fileExists: (p: string) => files.has(p), readFileHead: (p: string) => files.get(p) ?? null,
      writeFileAtomic: (p: string, s: string) => { files.set(p, s); return true; },
      lockFile: () => { if (locked) return null; locked = true; return 'lock'; }, unlockFile: () => { locked = false; return true; } },
  } as unknown as Host;
  return { host, files };
}
export const surface = { surface: 'studio', instance: 'instance', tab: 'child', owner: 'owner', actor: 'owner', actorLabel: 'Owner' };
export const document = { plugin: 'higgsfield', origin: 'document', ...surface, workspace: 'workspace', frame: 'frame', actor: { kind: 'local' } };


