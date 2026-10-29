import type { Host } from '@codeterm/plugin-sdk';
import { createRuntime } from './runtime';
declare const host: Host;
export default createRuntime(host);
