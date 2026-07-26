import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { primeMail } from './data/imap/connect';
import './styles/tokens.css';
import './styles/base.css';

/*
 * Awaited before the first render, because `useRestoreProvider` chooses the
 * mail provider *during* that render — an effect resolving a moment later would
 * already have shown a signed-in user the demo mailbox. On the web this
 * resolves immediately; on the desktop it is one Keychain read.
 */
await primeMail();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
