// File: Editor de plantillas con chips de columnas y vista previa en vivo.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useRef } from 'react';
import { interpolate } from '../../electron/whatsapp/template';

/**
 * Editor amigable de plantillas de campaña:
 *  - chips con las columnas del CSV cargado; clic inserta `{columna}` en el
 *    cursor, y el botón `$` inserta `{columna:dinero}` (formato MXN forzado)
 *  - vista previa en vivo interpolada con la primera fila del CSV
 * Usa el MISMO motor que el envío real (electron/whatsapp/template) → lo que
 * se ve en la preview es exactamente lo que recibe el contacto.
 */
export function TemplateEditor({
  value,
  onChange,
  columns,
  sampleRow,
}: {
  value: string;
  onChange: (tpl: string) => void;
  columns: string[];
  sampleRow: Record<string, string> | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (snippet: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + snippet);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    // Devuelve el foco con el cursor después de lo insertado.
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + snippet.length;
    });
  };

  return (
    <div className="space-y-2">
      {columns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {columns.map((col) => (
            <span
              key={col}
              className="inline-flex items-stretch overflow-hidden rounded-lg border border-neutral-50 bg-white text-xs"
            >
              <button
                type="button"
                title={`Insertar {${col}}`}
                onClick={() => insert(`{${col}}`)}
                className="px-2 py-1 font-mono hover:bg-primary-light-90"
              >
                {col}
              </button>
              <button
                type="button"
                title={`Insertar {${col}:dinero} (formato $ MXN)`}
                onClick={() => insert(`{${col}:dinero}`)}
                className="border-l border-neutral-50 px-1.5 py-1 font-semibold text-secondary hover:bg-primary-light-90"
              >
                $
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
      />

      <p className="text-xs text-text-light">
        <code className="font-mono">{'{columna}'}</code> interpola un campo;{' '}
        <code className="font-mono">{'{saldo*0.9}'}</code> calcula;{' '}
        <code className="font-mono">{':dinero'}</code> fuerza formato $ MXN y{' '}
        <code className="font-mono">{':num'}</code> lo quita (ej.{' '}
        <code className="font-mono">{'{saldo:num}'}</code>).
      </p>

      {sampleRow && (
        <div className="rounded-xl border border-neutral-50 bg-neutral-30 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-light">
            Vista previa (primer contacto del CSV)
          </div>
          <div className="max-w-md rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm whitespace-pre-wrap">
            {interpolate(value, sampleRow) || (
              <span className="text-text-light">Escribe la plantilla…</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Encabezados + primera fila de datos de un CSV (para chips y preview).
 * Parser mínimo con soporte de comillas; suficiente para una preview.
 */
export function parseCsvPreview(text: string): {
  columns: string[];
  sampleRow: Record<string, string> | null;
} {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length && rows.length < 2; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      field = '';
      row = [];
    } else field += ch;
  }
  if (rows.length < 2 && (field !== '' || row.length > 0)) {
    row.push(field);
    rows.push(row);
  }

  const columns = (rows[0] ?? []).map((c) => c.trim()).filter(Boolean);
  if (columns.length === 0) return { columns: [], sampleRow: null };

  const values = rows[1];
  if (!values) return { columns, sampleRow: null };
  const sampleRow: Record<string, string> = {};
  columns.forEach((c, i) => (sampleRow[c] = (values[i] ?? '').trim()));
  return { columns, sampleRow };
}
