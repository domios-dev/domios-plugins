import { HiggsfieldCommands } from './commands';
import type { CommandPorts } from './commands';
import { HiggsfieldBlueprint } from './blueprint';
import type { RunPorts } from './blueprint';
import { manifestSource } from './contributions';
import type { HiggsfieldService } from './service';

/** Following UI/delivery task supplies the real host authority/store/continuation ports.
 * No module-global fake job store, credentials, host.jobs or paid recipe is installed. */
export function createHiggsfieldAdapters(service: HiggsfieldService, commands: CommandPorts, run: RunPorts) {
  const c = new HiggsfieldCommands(service, commands), b = new HiggsfieldBlueprint(service, run);
  return { manifestSource, commands: c, blueprint: b,
    onAgentCommand: c.onAgentCommand.bind(c), onSurfaceCall: c.onSurfaceCall.bind(c), viewCall: c.viewCall.bind(c) };
}
