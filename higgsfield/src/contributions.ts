import { verbs } from './commands';
import { blueprintContracts } from './blueprint';

/** Manifest SOURCE contribution for the following UI/delivery tasks. No fake UI entry,
 * runnable runner, min-host or released SDK declaration is installed by this slice. */
export const surfaceContribution = {
  id: 'studio', title: 'Higgsfield', renderer: 'view', agentBound: true,
  agentVerbs: [...verbs], stateInvalidation: true, restore: 'relaunch',
};
export const manifestSource = {
  surfaces: [surfaceContribution],
  graphNodes: { steps: blueprintContracts },
  graphRegistration: 'withheld-until-external-closed-schema-and-runner-delivery',
};
