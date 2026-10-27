'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Section } from '@/lib/sections';
import { LogoutDialog } from './LogoutButton';
import { RealtimeIndicator } from './Realtime';

export interface AppHeaderProps {
  username: string;
  /** Secciones YA filtradas por permisos. */
  sections: readonly Section[];
}

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Header sticky con gradiente, marca, navegación en pills y menú de usuario. */
export function AppHeader({ username, sections }: AppHeaderProps) {
  const pathname = usePathname() ?? '/';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setUserOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!userOpen && !mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserOpen(false);
        setMobileOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [userOpen, mobileOpen]);

  const pill = (active: boolean) =>
    cn(
      'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary',
      active ? 'bg-white text-primary' : 'text-primary-foreground hover:bg-white/15',
    );

  return (
    <header className="pernexium-gradient sticky top-0 z-30 border-b border-white/10 text-primary-foreground">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          <span className="text-sm font-black uppercase tracking-[0.25em] text-primary-foreground">PERNEXIUM</span>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">ANA Admin</span>
        </Link>

        <nav aria-label="Secciones" className="hidden flex-1 items-center gap-1 md:flex">
          <Link href="/" className={pill(isActive(pathname, '/'))} aria-current={isActive(pathname, '/') ? 'page' : undefined}>
            Inicio
          </Link>
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={pill(isActive(pathname, s.href))}
              aria-current={isActive(pathname, s.href) ? 'page' : undefined}
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <RealtimeIndicator />
          <div ref={userRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={userOpen}
              aria-label={`Menú de usuario ${username}`}
              onClick={() => setUserOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <span className="max-w-[10rem] truncate font-mono text-xs">{username}</span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            {userOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 rounded-xl border border-neutral-50 bg-white p-2 text-text shadow-card animate-enter"
              >
                <p className="px-3 py-2 text-xs text-text-light">
                  Sesión de <span className="font-mono">{username}</span>
                </p>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setUserOpen(false);
                    setLogoutOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-error-70 hover:bg-error-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={mobileOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((o) => !o)}
            className="rounded-lg p-2 text-primary-foreground hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary md:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Secciones (móvil)" className="border-t border-white/10 px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col gap-1">
            <Link href="/" className={pill(isActive(pathname, '/'))}>
              Inicio
            </Link>
            {sections.map((s) => (
              <Link key={s.href} href={s.href} className={pill(isActive(pathname, s.href))}>
                {s.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
      <LogoutDialog open={logoutOpen} onCancel={() => setLogoutOpen(false)} />
    </header>
  );
}
