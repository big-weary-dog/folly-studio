// One permission query shared by the editor and library pickers.
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

import { api } from '../api.ts';

const customCode = signal<boolean | null>(null);
let asked = false;
export function useCustomCode() {
  useEffect(() => {
    if (asked) return;
    asked = true;
    api.baking().then((b) => { customCode.value = b.customCode; }, () => { asked = false; });
  }, []);
  return customCode.value;
}
