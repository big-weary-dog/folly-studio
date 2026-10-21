// The Admin page (SPEC-access): a tab per admin area, each its own URL under /admin over the page it names, and a
// link to the Pi's dry-run page. Only admins see the tabs; for anyone else each page's own API refuses, as before.
import '../../css/admin.css';

import type { ComponentType } from 'preact';

import { can } from '../../../shared/policy.ts';
import { user, type ViewProps } from './session.ts';

const TABS = [['models', 'Models'], ['access', 'Access'], ['light', 'Light'], ['reports', 'Reports']];

/** The page under the Admin tabs, `tab` lit. */
export const withTabs = (Page: ComponentType<ViewProps>, tab: string) => (props: ViewProps) => <>
  {can(user.value, 'admin') && <nav class="seg admin-tabs" aria-label="Admin">
    {TABS.map(([id, text]) => <a class="seg-btn" data-tab={id} href={`/admin/${id}`}
      aria-current={id === tab ? 'page' : undefined}>{text}</a>)}
    <a class="seg-btn" data-tab="pi" href="/pi/" target="_blank" rel="noopener"
      title="The Pi's dry-run page, in a new tab (PI_PREVIEW_URL)">Pi ↗</a>
  </nav>}
  <Page {...props} />
</>;
