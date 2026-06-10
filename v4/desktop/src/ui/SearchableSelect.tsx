// File: Dropdown buscable (combobox) para listas largas, p.ej. campañas.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useRef, useState } from 'react';

/**
 * Combobox simple: input que filtra mientras escribes + lista de opciones.
 * Solo se puede ELEGIR una opción existente (escribir no setea el valor),
 * así nunca viaja al backend un nombre de campaña inventado.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Buscar…',
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false); // sin espacio abajo → abre arriba
  const rootRef = useRef<HTMLDivElement>(null);

  const LIST_MAX_PX = 224; // max-h-56

  const openList = () => {
    setQuery('');
    // Decide dirección con el espacio real en viewport al momento de abrir.
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < LIST_MAX_PX && rect.top > below);
    }
    setOpen(true);
  };

  // Cierra al hacer clic fuera.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div ref={rootRef} className="relative">
      <input
        value={open ? query : value}
        placeholder={value || placeholder}
        onFocus={openList}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-xl border border-neutral-50 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
      />
      {open && (
        <ul
          className={`absolute z-20 max-h-56 w-full overflow-y-auto rounded-xl border border-neutral-50 bg-white shadow-lg ${
            dropUp ? 'bottom-full mb-1' : 'mt-1'
          }`}
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-text-light">Sin coincidencias.</li>
          )}
          {filtered.map((o) => (
            <li key={o}>
              <button
                type="button"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-neutral-30 ${
                  o === value ? 'bg-primary-light-90 font-semibold' : ''
                }`}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
