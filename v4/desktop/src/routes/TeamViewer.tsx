// File: Selector para ver conversaciones de agentes.
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import {
  getAgents,
  getCampaigns,
  getJobsSummary,
  reassignJobs,
  type AgentEntry,
  type JobsOperatorSummary,
  type UserAccess,
} from '../lib/api';
import { SearchableSelect } from '../ui/SearchableSelect';
import { teamPanel } from '../lib/permissions';

/**
 * Panel de equipo (v4-enforce-permissions):
 *  - "Ver como" (admin o `ana:chats:team:view`): elige campaña (un líder, solo
 *    las suyas) y luego agente; solo lectura.
 *  - "Envíos pendientes" con `ana:team:jobs:view`; "Mover" con `ana:team:jobs:manage`.
 * value = operatorId visto (null = mis propias conversaciones).
 */
export function TeamViewer({
  access,
  value,
  onChange,
}: {
  access: UserAccess | null;
  value: string | null;
  onChange: (operatorId: string | null) => void;
}) {
  const isAdmin = !!access?.isAdmin;
  const perms = teamPanel(access);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<string>('');
  const [agents, setAgents] = useState<AgentEntry[]>([]);

  // Campaña efectiva para el panel de envíos: la elegida o (no admin) la primera propia.
  const ownCampaign = (access?.campaigns ?? []).find((c) => c !== '*') ?? '';
  const jobsCampaign = campaign || (isAdmin ? '' : ownCampaign);

  // Con "Ver como": campañas elegibles (el backend limita las del líder).
  // Sin él (solo pendientes): los agentes de sus campañas directo.
  useEffect(() => {
    if (perms.viewAs) {
      void getCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
    } else if (!isAdmin) {
      void getAgents().then(setAgents).catch(() => setAgents([]));
    }
  }, [perms.viewAs, isAdmin]);

  // Al elegir campaña, carga sus agentes y vuelve a "Mis conversaciones".
  useEffect(() => {
    if (!campaign) return;
    void getAgents(campaign).then(setAgents).catch(() => setAgents([]));
    onChange(null);
  }, [campaign]);

  return (
    <div className="space-y-2 border-b border-neutral-50 bg-neutral-30 p-3">
      {/* "Ver como" (conversaciones de otro agente, solo lectura). */}
      {perms.viewAs && (
        <>
          <div className="text-xs font-semibold uppercase tracking-wider text-text-light">
            Ver como
          </div>
          <SearchableSelect
            value={campaign}
            onChange={setCampaign}
            options={campaigns}
            placeholder="Buscar campaña…"
          />
          <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full rounded-xl border border-neutral-50 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
          >
            <option value="">Mis conversaciones</option>
            {agents.map((a) => (
              <option key={a.operatorId} value={a.operatorId}>
                {a.operatorId} {a.active ? '· activo' : '· offline'}
              </option>
            ))}
          </select>
        </>
      )}

      {/* Envíos pendientes por agente; "Mover" solo con ana:team:jobs:manage. */}
      {jobsCampaign && perms.jobs && (
        <JobsPanel campaign={jobsCampaign} agents={agents} canMove={perms.move} />
      )}
    </div>
  );
}

/**
 * Envíos pendientes por agente de la campaña, con reasignación (el reemplazo
 * v4 del consume-once de v3: si un agente se desconecta a media campaña, el
 * líder mueve sus pendientes a otro agente).
 */
function JobsPanel({
  campaign,
  agents,
  canMove,
}: {
  campaign: string;
  agents: AgentEntry[];
  canMove: boolean;
}) {
  const [rows, setRows] = useState<JobsOperatorSummary[]>([]);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({}); // from → to
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const refresh = () =>
    getJobsSummary(campaign)
      .then((s) => setRows(s.operators))
      .catch(() => setRows([]));

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [campaign]);

  const reassign = async (from: string) => {
    const to = moveTo[from];
    if (!to || busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await reassignJobs(campaign, from, to);
      setNote(`${r.moved} envíos movidos a ${to}`);
      await refresh();
    } catch {
      setNote('No se pudieron reasignar los envíos');
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border border-neutral-50 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-light">
        Envíos pendientes · {campaign}
      </div>
      {rows.map((r) => (
        <div key={r.operatorId} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{r.operatorId}</span>
          <span className="shrink-0 rounded-full bg-neutral-30 px-2 py-0.5 text-xs">
            {r.pending} pendientes
          </span>
          {(r.review ?? 0) > 0 && (
            <span className="shrink-0 rounded-full bg-error-10 px-2 py-0.5 text-xs text-error-70">
              {r.review} por revisar
            </span>
          )}
          {r.pending > 0 && canMove ? (
          <>
          <select
            value={moveTo[r.operatorId] ?? ''}
            onChange={(e) => setMoveTo({ ...moveTo, [r.operatorId]: e.target.value })}
            className="w-28 shrink-0 rounded-lg border border-neutral-50 px-1 py-0.5 text-xs"
          >
            <option value="">Mover a…</option>
            {agents
              .filter((a) => a.operatorId !== r.operatorId)
              .map((a) => (
                <option key={a.operatorId} value={a.operatorId}>
                  {a.operatorId}
                </option>
              ))}
          </select>
          <button
            disabled={busy || !moveTo[r.operatorId]}
            onClick={() => void reassign(r.operatorId)}
            className="shrink-0 rounded-lg bg-primary px-2 py-0.5 text-xs text-white disabled:opacity-40"
          >
            Mover
          </button>
          </>
          ) : null}
        </div>
      ))}
      {rows.some((r) => (r.review ?? 0) > 0) && (
        <div className="text-xs text-text-light">Resuélvelos desde ANA Admin.</div>
      )}
      {note && <div className="text-xs text-text-light">{note}</div>}
    </div>
  );
}
