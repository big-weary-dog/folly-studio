// Admin areas have their own URLs: tabs on laptop, a selector and quick operator tasks on phone (SPEC-studio).
// The shared admin permission gates navigation and controls.
import '../../css/admin.css';

import type { ComponentType } from 'preact';

import { can } from '../../../shared/policy.ts';
import { navigate, user, type ViewProps } from './session.ts';
import { usePhone } from './phone/viewport.ts';

const TABS = [['models', 'Models'], ['access', 'Access'], ['light', 'Light'], ['baking', 'Baking'],
  ['reports', 'Reports'], ['stats', 'Stats']];

/** The page under the Admin tabs, `tab` lit. */
export const withTabs = (Page: ComponentType<ViewProps>, tab: string) => (props: ViewProps) => {
  const phone = usePhone();
  if (!can(user.value, 'admin')) return <div class="page">
    <h1 class="page-title">Admin access required</h1>
    <p class="lede">You need an admin account to view or change these settings.</p>
    <a class="btn ghost" href="/studio">Go to Studio</a>
  </div>;
  return <>
  {phone ? <label class="admin-picker">Admin
    <select aria-label="Admin page" value={tab} onChange={(e) => navigate(`/admin/${e.currentTarget.value}`)}>
      {TABS.map(([id, text]) => <option value={id}>{text}</option>)}
    </select>
  </label> : <nav class="seg admin-tabs" aria-label="Admin">
    {TABS.map(([id, text]) => <a class="seg-btn" data-tab={id} href={`/admin/${id}`}
      aria-current={id === tab ? 'page' : undefined}>{text}</a>)}
  </nav>}
  {phone && tab === 'models' ? <div class="page">
    <h1 class="page-title">Models</h1>
    <p class="pane-hint">Open this page on a laptop to configure models.</p>
  </div> : <Page {...props} />}
</>;
};
