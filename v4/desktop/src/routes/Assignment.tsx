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
  const firstSelected = jobs.find((j) => selected.has(j.jobId)) ?? jobs[0];
  const columns = useMemo(
    () => (firstSelected ? Object.keys(firstSelected.row) : []),
    [firstSelected],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allSelected = jobs.length > 0 && selected.size === jobs.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(jobs.map((j) => j.jobId)));

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

      {jobs.length === 0 ? (
        <div className="pernexium-card mt-6 p-6 text-sm text-text-light">
          Sin contactos asignados por ahora. Cuando tu líder reparta una campaña (o
          subas un CSV propio), aparecerán aquí.
        </div>
      ) : (
        <div className="pernexium-card mt-6 space-y-4 p-6">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              {selected.size}/{jobs.length} seleccionados
            </label>
            {firstSelected?.campaign && (
              <span className="rounded-full bg-primary-light-90 px-2 py-0.5 text-xs text-primary">
                {firstSelected.campaign}
              </span>
            )}
          </div>

          <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-neutral-50">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-30 text-left text-xs uppercase tracking-wider text-text-light">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Teléfono</th>
                  <th className="px-3 py-2">Archivo</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.jobId}
                    onClick={() => toggle(j.jobId)}
                    className="cursor-pointer border-t border-neutral-50 hover:bg-neutral-30"
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(j.jobId)}
                        onChange={() => toggle(j.jobId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {j.row.name || j.row.nombre || j.row.first_name || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{maskPhone(j.phone)}</td>
                    <td className="max-w-40 truncate px-3 py-2 text-xs text-text-light">
                      {j.campaignId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
