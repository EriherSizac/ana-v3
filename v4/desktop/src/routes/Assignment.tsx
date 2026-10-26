// File: Mi asignación — el agente revisa, selecciona y aprueba sus envíos.
// Created: 2026-06-10
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { TemplateEditor, getUnknownTemplateVars } from '../ui/TemplateEditor';
import { ProgressBar } from './Campaigns';
import { maskPhone } from '../lib/api';
import { truncationNotice } from '../lib/assignmentNotice';
import type { AssignedJob, AssignmentInfo, SendProgress } from '../types/ana';

const isPending = (j: AssignedJob) => !j.status || j.status === 'pending' || j.status === 'leased';
const isDone = (j: AssignedJob) =>
  j.status === 'sent' || j.status === 'no_whatsapp' || j.status === 'error';
/** Archivo de un job (misma clave que usa el main para la plantilla). */
const fileKey = (j: AssignedJob) => j.srcKey || j.campaignId;
/** Nombre legible del archivo: último segmento del srcKey o la campaña. */
const fileLabel = (j: AssignedJob) =>
  (j.srcKey ? j.srcKey.split('/').pop() : '') || j.campaign || j.campaignId;

interface FileGroup {
  key: string;
  label: string;
  jobs: AssignedJob[]; // seleccionados de este archivo
  defaultTemplate: string;
  columns: string[];
  sampleRow: Record<string, string>;
}

/**
 * Equivalente v4 de la asignación de v3: el poller del main publica los jobs
 * pendientes del agente; aquí los revisa, elige a quiénes enviar y, POR CADA
 * ARCHIVO seleccionado, con qué plantilla; y aprueba. Cada job se envía con la
 * plantilla de su archivo. Lo no seleccionado queda pendiente (reaparece).
 */
export function Assignment() {
  const [jobs, setJobs] = useState<AssignedJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Plantillas editadas por el agente, por archivo (las no editadas usan la del upload).
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<SendProgress>({ phase: 'idle' });
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'pending' | 'sent'>('pending');
  const [info, setInfo] = useState<AssignmentInfo | null>(null);

  useEffect(() => {
    const apply = (next: AssignedJob[]) => {
      setJobs(next);
      // Selección estable entre polls: conserva lo marcado que SIGUE pendiente
      // (descarta lo ya procesado) y marca los pendientes nuevos.
      setSelected((prev) => {
        const pendingIds = new Set(next.filter((j) => !j.auto && isPending(j)).map((j) => j.jobId));
        const keep = new Set([...prev].filter((id) => pendingIds.has(id)));
        for (const id of pendingIds) if (!prev.has(id)) keep.add(id);
        return keep;
      });
    };
    // Hidratar al montar con la asignación vigente (el evento del poller solo
    // llega cada ~5s; sin esto la vista queda en blanco al entrar al tab).
    void window.ana.getAssignment().then(apply);
    void window.ana.getAssignmentInfo().then(setInfo);
    const offJobs = window.ana.onJobsAssignment(apply);
    const offInfo = window.ana.onJobsAssignmentInfo(setInfo);
    const offProgress = window.ana.onWaProgress(setProgress);
    return () => {
      offJobs();
      offInfo();
      offProgress();
    };
  }, []);

  const sendingNow = progress.phase === 'sending' || progress.phase === 'waiting';

  // Pendientes: por aprobar (manual). Enviados: historial, más reciente arriba.
  const pendingJobs = useMemo(() => jobs.filter((j) => !j.auto && isPending(j)), [jobs]);
  const sentJobs = useMemo(
    () => jobs.filter(isDone).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)),
    [jobs],
  );
  const list = tab === 'pending' ? pendingJobs : sentJobs;
  // Aviso si el backend no entregó todos los pendientes (límite del poll).
  const notice = truncationNotice(info, jobs.filter(isPending).length);

  // Un grupo (editor de plantilla) por archivo con jobs seleccionados.
  const groups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, FileGroup>();
    for (const j of pendingJobs) {
      if (!selected.has(j.jobId)) continue;
      const k = fileKey(j);
      let g = map.get(k);
      if (!g) {
        g = {
          key: k,
          label: fileLabel(j),
          jobs: [],
          defaultTemplate: j.template ?? '',
          columns: Object.keys(j.row ?? {}),
          sampleRow: j.row ?? {},
        };
        map.set(k, g);
      }
      g.jobs.push(j);
    }
    return [...map.values()];
  }, [pendingJobs, selected]);

  const templateOf = (g: FileGroup) => edited[g.key] ?? g.defaultTemplate;
  // Validación por archivo: vacía o con variables que su CSV no tiene.
  const problems = groups.map((g) => {
    const tpl = templateOf(g);
    if (!tpl.trim()) return { empty: true, unknown: [] as string[] };
    return { empty: false, unknown: getUnknownTemplateVars(tpl, g.columns) };
  });
  const invalid = problems.some((p) => p.empty || p.unknown.length > 0);
  const selectedPending = groups.reduce((n, g) => n + g.jobs.length, 0);

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
    const templates: Record<string, string> = {};
    for (const g of groups) templates[g.key] = templateOf(g);
    const ids = groups.flatMap((g) => g.jobs.map((j) => j.jobId));
    // El main responde en cuanto el envío arranca; el avance va por la tarjeta.
    const res = await window.ana.approveJobs(ids, templates);
    setStatus(res.ok ? 'Envío iniciado.' : `Error: ${res.error ?? 'desconocido'}`);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold">Mi asignación</h1>
      <p className="mt-1 text-sm text-text-light">
        Contactos pendientes asignados a ti. Selecciona a quiénes enviarles y con qué
        plantilla; lo no seleccionado queda pendiente para después.
      </p>

      {notice && (
        <div role="status" className="mt-4 rounded-xl bg-primary-light-90 px-4 py-2 text-sm text-text-muted">
          {notice}
        </div>
      )}

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
                {selectedPending}/{pendingJobs.length} seleccionados
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
              {/* Un editor por archivo seleccionado: cada contacto recibe la plantilla de su carga. */}
              {groups.map((g, i) => (
                <div key={g.key}>
                  <label className="block text-sm font-semibold text-text-muted">
                    Mensaje
                    {groups.length > 1 && (
                      <span className="ml-1 font-normal text-text">
                        · {g.label} ({g.jobs.length} seleccionado{g.jobs.length === 1 ? '' : 's'})
                      </span>
                    )}
                    {!g.defaultTemplate.trim() ? (
                      <span className="ml-1 text-error-70">(obligatorio: el líder no fijó uno)</span>
                    ) : (
                      <span className="ml-1 font-normal text-text-light">(puedes editarlo)</span>
                    )}
                  </label>
                  <div className="mt-1">
                    <TemplateEditor
                      value={templateOf(g)}
                      onChange={(t) => setEdited((m) => ({ ...m, [g.key]: t }))}
                      columns={g.columns}
                      sampleRow={g.sampleRow}
                    />
                  </div>
                  {problems[i]?.empty && (
                    <p className="mt-1 text-xs text-error-70">Escribe el mensaje antes de enviar.</p>
                  )}
                  {problems[i] && problems[i].unknown.length > 0 && (
                    <p className="mt-1 text-xs text-error-70">
                      Variables que este archivo no tiene:{' '}
                      <span className="font-mono">
                        {problems[i].unknown.map((v) => `{${v}}`).join(', ')}
                      </span>
                    </p>
                  )}
                </div>
              ))}

              <Button
                onClick={send}
                disabled={selectedPending === 0 || sendingNow || invalid}
              >
                {sendingNow ? 'Enviando…' : `Enviar a ${selectedPending} contacto(s)`}
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
