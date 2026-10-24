import type { ComponentChildren } from 'preact';
import { usePhone } from './viewport.ts';

/** Keep a laptop surface in place; on phone reveal it with a labelled, full-size tap. */
export function PhoneDisclosure({ label, children }: { label: string; children: ComponentChildren }) {
  return usePhone()
    ? <details class="phone-disclosure"><summary>{label}</summary>{children}</details> : <>{children}</>;
}
