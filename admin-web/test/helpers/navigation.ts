import { vi } from 'vitest';

// Mock de next/navigation para pruebas de componentes:
//   vi.mock('next/navigation', () => import('../helpers/navigation'));

export const router = {
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

const state = { pathname: '/', search: new URLSearchParams() };

export function setLocation(pathname: string, search = ''): void {
  state.pathname = pathname;
  state.search = new URLSearchParams(search);
}

export function resetNavigation(): void {
  for (const f of Object.values(router)) f.mockReset();
  setLocation('/');
}

export const useRouter = () => router;
export const usePathname = () => state.pathname;
export const useSearchParams = () => state.search;
export const notFound = vi.fn();
export const redirect = vi.fn();
