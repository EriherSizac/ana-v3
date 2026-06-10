// File: Mi asignación — el agente revisa, selecciona y aprueba sus envíos.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { TemplateEditor } from '../ui/TemplateEditor';
import { ProgressBar } from './Campaigns';
import { maskPhone } from '../lib/api';
import type { AssignedJob, SendProgress } from '../types/ana';

/**
 * Equivalente v4 de la asignación de v3: el poller del main publica los jobs
 * pendientes del agente; aquí los revisa, elige a quiénes enviar y con qué
 * plantilla, y aprueba. Lo no seleccionado queda pendiente (reaparece).
 */
export function Assignment() {
  const [jobs, setJobs] = useState<AssignedJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState('');
  const [templateTouched, setTemplateTouched] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<SendProgress>({ phase: 'idle' });
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'pending' | 'sent'>('pending');

  useEffect(() => {
    const apply = (next: AssignedJob[]) => {
      setJobs(next);
      // Selección estable entre polls: conserva lo marcado, marca lo nuevo.
      setSelected((prev) => {
        const ids = new Set(next.map((j) => j.jobId));
        const keep = new Set([...prev].filter((id) => ids.has(id)));
        for (const j of next) if (!prev.has(j.jobId) && !keep.has(j.jobId)) keep.add(j.jobId);
        return keep;
      });
      // Plantilla por defecto = la del upload, mientras el agente no la edite.
      if (next.length > 0) {
        setTemplate((t) => (templateTouched && t ? t : next[0].template));
      }
    };
    // Hidratar al montar con la asignación vigente (el evento del poller solo
    // llega cada ~5s; sin esto la vista queda en blanco al entrar al tab).
    void window.ana.getAssignment().then(apply);
    const offJobs = window.ana.onJobsAssignment(apply);
    const offProgress = window.ana.onWaProgress(setProgress);
    return () => {
      offJobs();
      offProgress();
    };
  }, [templateTouched]);

  const sendingNow = progress.phase === 'sending' || progress.phase === 'waiting';

  const isPending = (j: AssignedJob) =>
    !j.status || j.status === 'pending' || j.status === 'leased';
  const isDone = (j: AssignedJob) =>
    j.status === 'sent' || j.status === 'no_whatsapp' || j.status === 'error';

  // Pendientes: por aprobar (manual). Enviados: historial, más reciente arriba.
  const pendingJobs = useMemo(() => jobs.filter((j) => !j.auto && isPending(j)), [jobs]);
  const sentJobs = useMemo(
    () => jobs.filter(isDone).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)),
    [jobs],
  );
  const list = tab === 'pending' ? pendingJobs : sentJobs;

  const firstSelected = pendingJobs.find((j) => selected.has(j.jobId)) ?? pendingJobs[0];
  const columns = useMemo(
    () => (firstSelected ? Object.keys(firstSelected.row) : []),
    [firstSelected],
  );

  // Filtra por nombre, credit_id o últimos dígitos del teléfono.
  const jobName = (j: AssignedJob) =>
    j.row.name || j.row.nombre || `${j.row.first_name ?? ''} ${j.row.last_name ?? ''}`.trim();
  const jobCredit = (j: AssignedJob) =>
    j.row.credit || j.row.credito || j.row.credit_id || j.row.id_credito || '';
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    const qDigits = q.replace(/\D/g, '');
    return list.filter((j) => {
      const phone = j.phone.replace(/\D/g, '');
      return (
        jobName(j).toLowerCase().includes(q) ||
        jobCredit(j).toLowerCase().includes(q) ||
        (qDigits.length >= 2 && phone.includes(qDigits))
      );
    });
  }, [list, query]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // "Todos" opera sobre lo filtrado (lo que el agente está viendo).
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((j) => selected.has(j.jobId));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allFilteredSelected) for (const j of filtered) n.delete(j.jobId);
      else for (const j of filtered) n.add(j.jobId);
      return n;
    });

  async function send() {
    setStatus(null);
    const res = await window.ana.approveJobs([...selected], template || undefined);
    setStatus(res.ok ? 'Envío iniciado.' : `Error: ${res.error ?? 'desconocido'}`);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold">Mi asignación</h1>
      <p className="mt-1 text-sm text-text-light">
        Contactos pendientes asignados a ti. Selecciona a quiénes enviarles y con qué
        plantilla; lo no seleccionado queda pendiente para después.
      </p>

      {/* Tabs: pendientes (por enviar) / enviados (historial). */}
      <div className="mt-4 flex gap-1 border-b border-neutral-50">
        <TabBtn active={tab === 'pending'} onClick={() => setTab('pending')}>
          Pendientes ({pendingJobs.length})
        </TabBtn>
        <TabBtn active={tab === 'sent'} onClick={() => setTab('sent')}>
          Enviados ({sentJobs.length})
        </TabBtn>
      </div>

      {list.length === 0 ? (
        <div className="pernexium-card mt-4 p-6 text-sm text-text-light">
          {tab === 'pending'
            ? 'Sin contactos pendientes. Cuando tu líder reparta una campaña (o subas un CSV propio), aparecerán aquí.'
            : 'Aún no hay envíos. El historial muestra los contactos ya procesados.'}
        </div>
      ) : (
        <div className="pernexium-card mt-4 space-y-4 p-6">
          <div className="flex items-center justify-between">
            {tab === 'pending' ? (
              <label className="flex items-center gap-2 text-sm font-semibold text-text-muted">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} />
                {selected.size}/{pendingJobs.length} seleccionados
              </label>
            ) : (
              <span className="text-sm font-semibold text-text-muted">
                {sentJobs.length} en el historial
              </span>
            )}
            {list[0]?.campaign && (
              <span className="rounded-full bg-primary-light-90 px-2 py-0.5 text-xs text-primary">
                {list[0].campaign}
              </span>
            )}
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, crédito o últimos dígitos del teléfono…"
            className="w-full rounded-xl border border-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
          />

          <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-neutral-50">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-30 text-left text-xs uppercase tracking-wider text-text-light">
                <tr>
                  {tab === 'pending' && <th className="w-8 px-3 py-2" />}
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Crédito</th>
                  <th className="px-3 py-2">Teléfono</th>
                  {tab === 'sent' && <th className="px-3 py-2">Resultado</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-xs text-text-light">
                      Sin coincidencias para “{query}”.
                    </td>
                  </tr>
                )}
                {filtered.map((j) => (
                  <tr
                    key={j.jobId}
                    onClick={tab === 'pending' ? () => toggle(j.jobId) : undefined}
                    className={`border-t border-neutral-50 ${
                      tab === 'pending' ? 'cursor-pointer hover:bg-neutral-30' : ''
                    }`}
                  >
                    {tab === 'pending' && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(j.jobId)}
                          onChange={() => toggle(j.jobId)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">{jobName(j) || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{jobCredit(j) || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{maskPhone(j.phone)}</td>
                    {tab === 'sent' && (
                      <td className="px-3 py-2">
                        <StatusBadge status={j.status} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tab === 'pending' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-text-muted">Plantilla</label>
                <div className="mt-1">
                  <TemplateEditor
                    value={template}
                    onChange={(t) => {
                      setTemplate(t);
                      setTemplateTouched(true);
                    }}
                    columns={columns}
                    sampleRow={firstSelected?.row ?? null}
                  />
                </div>
              </div>

              <Button onClick={send} disabled={selected.size === 0 || sendingNow}>
                {sendingNow ? 'Enviando…' : `Enviar a ${selected.size} contacto(s)`}
              </Button>

              {status && (
                <div className="rounded-xl bg-primary-light-90 px-4 py-2 text-sm text-text-muted">
                  {status}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {progress.phase !== 'idle' && progress.total ? (
        <div className="mt-4">
          <ProgressBar p={progress} />
        </div>
      ) : null}
    </main>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-text-light hover:text-text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status?: AssignedJob['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: 'Enviado', cls: 'bg-secondary/15 text-secondary' },
    no_whatsapp: { label: 'Sin WhatsApp', cls: 'bg-neutral-50 text-text-muted' },
    error: { label: 'Error', cls: 'bg-error-10 text-error-70' },
  };
  const s = map[status ?? ''] ?? { label: status ?? '—', cls: 'bg-neutral-30 text-text-light' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>
  );
}
