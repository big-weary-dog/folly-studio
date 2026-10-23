// Draft pages share the shell's navigation and reload guard.
import { useLayoutEffect } from 'preact/hooks';

import { leaveGuard } from './session.ts';

export function useDraftGuard(dirty: boolean) {
  useLayoutEffect(() => {
    const isDirty = () => dirty;
    leaveGuard.isDirty = isDirty;
    delete leaveGuard.discard;
    return () => { if (leaveGuard.isDirty === isDirty) delete leaveGuard.isDirty; };
  }, [dirty]);
}
