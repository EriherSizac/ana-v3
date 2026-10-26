'use client';

import { createContext, useContext } from 'react';
import type { Access } from '@/lib/access';

export const AccessContext = createContext<Access | null>(null);

/** Acceso efectivo del usuario (solo dentro del gate de la consola). */
export function useAccess(): Access {
  const a = useContext(AccessContext);
  if (!a) throw new Error('useAccess fuera de ConsoleGate');
  return a;
}
