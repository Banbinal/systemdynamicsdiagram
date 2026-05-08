import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root in DOM');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
