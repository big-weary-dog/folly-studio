// The Pi's control page (pi/README.md "The control page"), built by pi/vite.config.js into pi/page/dist.
import '../../public/css/base.css';
import '../../public/css/live.css';
import './pi.css';

import { render } from 'preact';

import { App } from './app.tsx';

render(<App />, document.getElementById('app')!);
