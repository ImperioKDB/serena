import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/inter';
import { App } from './app/App';
import './styles/global.css';

autoMount();

function autoMount(): void {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Serena frontend root element is missing.');
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
