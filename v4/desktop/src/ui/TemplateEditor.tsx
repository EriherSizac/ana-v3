// File: Editor de plantillas con formato, chips de columnas y preview en vivo.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { Fragment, useRef, useState, type ReactNode } from 'react';
import { interpolate, normalizeContactRow } from '../../electron/whatsapp/template';

// Modificadores válidos al final de un placeholder ({campo:dinero} etc.).
const MOD_RE = /\s*:\s*(dinero|money|\$|num|numero|plain)$/i;

/**
 * Variables del template que NO existen en el CSV (considerando los alias
 * v3↔v4 que el motor normaliza). Vacío = todo embona.
 */
export function getUnknownTemplateVars(tpl: string, columns: string[]): string[] {
  if (columns.length === 0) return [];
  // Set de nombres conocidos = columnas + todos sus alias expandidos.
  const dummy: Record<string, string> = {};
  for (const c of columns) dummy[c] = '1';
  const known = new Set(Object.keys(normalizeContactRow(dummy)));

  const unknown = new Set<string>();
  for (const m of tpl.matchAll(/\{\{([^{}]+)\}\}|\{([^{}]+)\}/g)) {
    const expr = (m[1] ?? m[2]).trim().replace(MOD_RE, '');
    // Identificadores dentro del placeholder (campo simple o expresión).
    for (const id of expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)) {
      if (!known.has(id[0])) unknown.add(id[0]);
    }
  }
  return [...unknown];
}

/**
 * Editor amigable de plantillas de campaña:
 *  - barra de formato WhatsApp: *negrita*, _cursiva_, ~tachado~, ```mono```
 *    (envuelven el texto seleccionado)
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
  const [showFx, setShowFx] = useState(false);

  /** Inserta en el cursor (o reemplaza la selección) y devuelve el foco. */
  const insert = (snippet: string, selectInnerFrom?: number) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + (selectInnerFrom ?? snippet.length);
      el.selectionStart = el.selectionEnd = pos;
    });
  };

  /** Envuelve la selección con marcas de formato WhatsApp. */
  const wrap = (mark: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const inner = value.slice(start, end) || 'texto';
    onChange(value.slice(0, start) + mark + inner + mark + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = start + mark.length;
      el.selectionEnd = start + mark.length + inner.length;
    });
  };

  return (
    <div className="space-y-2">
      {/* barra de formato (sintaxis nativa de WhatsApp) */}
      <div className="flex flex-wrap items-center gap-1">
        <FormatBtn title="Negrita (*texto*)" onClick={() => wrap('*')}>
          <span className="font-bold">B</span>
        </FormatBtn>
        <FormatBtn title="Cursiva (_texto_)" onClick={() => wrap('_')}>
          <span className="italic">I</span>
        </FormatBtn>
        <FormatBtn title="Tachado (~texto~)" onClick={() => wrap('~')}>
          <span className="line-through">S</span>
        </FormatBtn>
        <FormatBtn title="Monoespaciado (```texto```)" onClick={() => wrap('```')}>
          <span className="font-mono">{'<>'}</span>
        </FormatBtn>
        <span className="mx-1 h-5 w-px bg-neutral-50" />
        <FormatBtn title="Salto de línea" onClick={() => insert('\n')}>
          ↵
        </FormatBtn>
        {columns.length > 0 && (
          <FormatBtn
            title="Insertar ecuación con variables (ej. saldo*0.9)"
            onClick={() => setShowFx((v) => !v)}
          >
            <span className="font-mono italic">fx</span>
          </FormatBtn>
        )}
        {columns.length === 0 && (
          <span className="ml-1 text-xs text-text-light">
            Sube un CSV para insertar sus columnas como variables.
          </span>
        )}
      </div>

      {showFx && columns.length > 0 && (
        <EquationBuilder
          columns={columns}
          onInsert={(expr) => {
            insert(expr);
            setShowFx(false);
          }}
        />
      )}

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

      <div className="rounded-xl border border-neutral-50 bg-neutral-30 p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-light">
          {sampleRow
            ? 'Vista previa (primer contacto del CSV)'
            : 'Vista previa (sin CSV: variables sin reemplazar)'}
        </div>
        <div className="w-fit max-w-md rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm whitespace-pre-wrap">
          {value ? (
            renderWhatsAppMarkup(sampleRow ? interpolate(value, sampleRow) : value)
          ) : (
            <span className="text-text-light">Escribe la plantilla…</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Constructor de ecuaciones: variable + operador + valor (número u otra
 * columna) → inserta `{var*0.9}` o `{var*0.9:dinero}` sin escribir sintaxis.
 */
function EquationBuilder({
  columns,
  onInsert,
}: {
  columns: string[];
  onInsert: (expr: string) => void;
}) {
  const [variable, setVariable] = useState(columns[0] ?? '');
  const [op, setOp] = useState('*');
  const [operand, setOperand] = useState('0.9');
  const [money, setMoney] = useState(true);

  const expr = `{${variable}${op}${operand.trim()}${money ? ':dinero' : ''}}`;
  const operandOk = /^\d+(\.\d+)?$/.test(operand.trim()) || columns.includes(operand.trim());

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-50 bg-primary-light-90 p-2 text-xs">
      <select
        value={variable}
        onChange={(e) => setVariable(e.target.value)}
        className="rounded-lg border border-neutral-50 bg-white px-2 py-1 font-mono"
      >
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={op}
        onChange={(e) => setOp(e.target.value)}
        className="rounded-lg border border-neutral-50 bg-white px-2 py-1 font-mono"
      >
        <option value="*">× por</option>
        <option value="/">÷ entre</option>
        <option value="+">+ más</option>
        <option value="-">− menos</option>
        <option value="%">% módulo</option>
      </select>
      <input
        value={operand}
        onChange={(e) => setOperand(e.target.value)}
        placeholder="0.9 o columna"
        list="fx-columns"
        className="w-28 rounded-lg border border-neutral-50 bg-white px-2 py-1 font-mono"
      />
      <datalist id="fx-columns">
        {columns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={money} onChange={(e) => setMoney(e.target.checked)} />
        formato $
      </label>
      <code className="rounded bg-white px-2 py-1 font-mono">{expr}</code>
      <button
        type="button"
        disabled={!variable || !operandOk}
        onClick={() => onInsert(expr)}
        className="rounded-lg bg-primary px-3 py-1 font-semibold text-white disabled:opacity-40"
      >
        Insertar
      </button>
      {!operandOk && <span className="text-error-70">valor: número o columna del CSV</span>}
    </div>
  );
}

function FormatBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="min-w-8 rounded-lg border border-neutral-50 bg-white px-2 py-1 text-xs hover:bg-primary-light-90"
    >
      {children}
    </button>
  );
}

/**
 * Render aproximado del formato de WhatsApp para la preview:
 * *negrita*, _cursiva_, ~tachado~, ```mono``` (sin anidación).
 */
function renderWhatsAppMarkup(text: string): ReactNode {
  const parts = text.split(/(```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```') && part.length > 6)
      return (
        <code key={i} className="font-mono">
          {part.slice(3, -3)}
        </code>
      );
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*'))
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith('~') && part.endsWith('~'))
      return <s key={i}>{part.slice(1, -1)}</s>;
    return <Fragment key={i}>{part}</Fragment>;
  });
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
