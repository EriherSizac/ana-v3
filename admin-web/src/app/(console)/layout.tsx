'use client';

import type { ReactNode } from 'react';
import { ConsoleGate } from '@/components/system/ConsoleGate';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <ConsoleGate>{children}</ConsoleGate>;
}
