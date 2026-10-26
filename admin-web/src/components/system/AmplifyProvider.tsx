'use client';

import { useRef } from 'react';
import { configureAmplify } from '@/lib/amplify';

export function AmplifyProvider() {
  // El cuerpo de useRef corre en render (cliente), antes de effects/llamadas
  // de auth de los hijos, y solo una vez por montaje.
  const done = useRef(false);
  if (!done.current) {
    configureAmplify();
    done.current = true;
  }
  return null;
}
