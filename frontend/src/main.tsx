import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './app/router';
import { AuthProvider } from './lib/auth';
import './styles/tokens.css';
import './styles/global.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root element missing');
}

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
