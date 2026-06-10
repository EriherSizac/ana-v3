// File: main
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureAmplify } from './lib/amplify';
import { App } from './App';
import './index.css';

configureAmplify();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
