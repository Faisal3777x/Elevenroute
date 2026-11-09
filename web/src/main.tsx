import './index.css';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { AuthProvider } from './lib/auth';
import { CACHE_BUSTER, CACHE_MAX_AGE, persister, queryClient } from './lib/query';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The query cache is restored from this browser before the first render, so pages open with data. */}
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: CACHE_BUSTER }}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
