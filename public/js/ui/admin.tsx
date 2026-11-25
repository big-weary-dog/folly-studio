// Admin areas have their own URLs: tabs on laptop, a selector and quick operator tasks on phone (SPEC-studio).
// The shared admin permission gates navigation and controls; /pi links to Studio Live's page.
import '../../css/admin.css';

import type { ComponentType } from 'preact';

import { can } from '../../../shared/policy.ts';
import { ai, navigate, onPi, user, type ViewProps } from './session.ts';
import { usePhone } from './phone/viewport.ts';

const TABS = [['models', 'Models'], ['access', 'Access'], ['light', 'Light'], ['baking', 'Baking'],
  ['reports', 'Reports'], ['stats', 'Stats'], ['pi-bundle', 'Pi bundle']];
// Without generators there is nothing to set for models or for who may use them; the Pi holds no bundle of itself
// (SPEC-offline).
const tabs = () => TABS.filter(([id]) => (ai.value || (id !== 'models' && id !== 'access'))
  && !(onPi() && id === 'pi-bundle'));

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
      {tabs().map(([id, text]) => <option value={id}>{text}</option>)}
    </select>
    <a class="btn ghost" href="/pi/" target="_blank" rel="noopener">Pi ↗</a>
  </label> : <nav class="seg admin-tabs" aria-label="Admin">
    {tabs().map(([id, text]) => <a class="seg-btn" data-tab={id} href={`/admin/${id}`}
      aria-current={id === tab ? 'page' : undefined}>{text}</a>)}
    <a class="seg-btn" data-tab="pi" href="/pi/" target="_blank" rel="noopener"
      title="Studio Live's control page, in a new tab (PI_PREVIEW_URL)">Pi ↗</a>
  </nav>}
  {phone && ['models', 'pi-bundle'].includes(tab) ? <div class="page">
    <h1 class="page-title">{TABS.find(([id]) => id === tab)?.[1]}</h1>
    <p class="pane-hint">Open this page on a laptop to
      {' '}{tab === 'models' ? 'configure models' : 'deploy a Pi bundle'}.</p>
  </div> : <Page {...props} />}
</>;
};
