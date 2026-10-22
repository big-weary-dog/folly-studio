// The Admin page (SPEC-access): a tab per admin area, each its own URL under /admin over the page it names, and a
// link to Studio Live's page (/pi). Only admins see the tabs; for anyone else each page's own API refuses, as before.
import '../../css/admin.css';

import type { ComponentType } from 'preact';

import { can } from '../../../shared/policy.ts';
import { onPi, user, type ViewProps } from './session.ts';

const TABS = [['models', 'Models'], ['access', 'Access'], ['light', 'Light'], ['baking', 'Baking'],
  ['reports', 'Reports'], ['stats', 'Stats'], ['pi-bundle', 'Pi bundle']];
// The Pi runs no models, so it has nothing to set for them or for who may use them (SPEC-offline).
const PI_TABS = TABS.filter(([id]) => id !== 'models' && id !== 'access');

/** The page under the Admin tabs, `tab` lit. */
export const withTabs = (Page: ComponentType<ViewProps>, tab: string) => (props: ViewProps) => <>
  {can(user.value, 'admin') && <nav class="seg admin-tabs" aria-label="Admin">
    {(onPi() ? PI_TABS : TABS).map(([id, text]) => <a class="seg-btn" data-tab={id} href={`/admin/${id}`}
      aria-current={id === tab ? 'page' : undefined}>{text}</a>)}
    <a class="seg-btn" data-tab="pi" href="/pi/" target="_blank" rel="noopener"
      title="Studio Live's control page, in a new tab (PI_PREVIEW_URL)">Pi ↗</a>
  </nav>}
  <Page {...props} />
</>;
