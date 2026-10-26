'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  FilterPill,
  InlineMessage,
  Input,
  Label,
  PageContainer,
  PageHeader,
  SearchableSelect,
  Skeleton,
  SkeletonRows,
  TableContainer,
} from '@/components/ui';
import { useCampaigns } from '@/components/system/useCampaigns';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';
import { mxDateTime, type LegacySearchResult } from '@/lib/legacy';
import { LegacyChatView } from './LegacyChatView';

const LEGACY_NOTE = 'Agente anterior al login Cognito; no activo';
const PAGE_SIZE = 50;

/** Historial legacy: búsqueda en solo lectura por campaña, agente legado, teléfono y fechas. */
export function LegacyHistoryView() {
  const { campaigns, loading: campaignsLoading, error: campaignsError } = useCampaigns();
  const [campaign, setCampaign] = useState<string | null>(null);
  const [legacyAgents, setLegacyAgents] = useState<string[]>([]);
  const [agent, setAgent] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LegacySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ agent: string; phone: string } | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPhone(phoneInput.replace(/\D/g, ''));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [phoneInput]);

  useEffect(() => {
    setAgent(null);
    setLegacyAgents([]);
    setOpen(null);
    setPage(1);
    if (!campaign) return;
    let cancelled = false;
    apiFetch<{ agents: string[] }>(`/api/campaigns/${encodeURIComponent(campaign)}/legacy-agents`)
      .then((r) => !cancelled && setLegacyAgents(r.agents))
      .catch(() => {
        /* el selector se completa con los agentes del índice */
      });
    return () => {
      cancelled = true;
    };
  }, [campaign]);

  const search = useCallback(async () => {
    if (!campaign) return;
    if (from && to && from > to) {
      setError('La fecha inicial es posterior a la final');
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (agent) qs.set('agent', agent);
    if (phone) qs.set('phone', phone);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('page', String(page));
    try {
      setResult(await apiFetch<LegacySearchResult>(`/api/campaigns/${encodeURIComponent(campaign)}/legacy-chats?${qs}`));
    } catch (e) {
      if (isRedirecting(e)) return;
      setResult(null);
      setError(e instanceof ApiError ? e.message : 'No se pudo buscar en el historial.');
    } finally {
      setLoading(false);
    }
  }, [campaign, agent, phone, from, to, page]);

  useEffect(() => {
    void search();
  }, [search]);

  // Selector: lista de legacy-agents unida a los agentes del índice ya vistos.
  const agentOptions = useMemo(() => {
    const names = new Set([...legacyAgents, ...(result?.conversations ?? []).map((c) => c.agent)]);
    if (agent) names.add(agent);
    return [...names].sort().map((a) => ({ value: a, label: `${a} · Legacy`, description: LEGACY_NOTE }));
  }, [legacyAgents, result, agent]);

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const hasFilters = !!(agent || phoneInput || from || to);

  if (open && campaign) {
    return (
      <PageContainer>
        <PageHeader title="Historial legacy" description={`Conversación legada de ${campaign} (solo lectura).`} />
        <LegacyChatView campaign={campaign} agent={open.agent} phone={open.phone} onBack={() => setOpen(null)} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Historial legacy" description="Conversaciones de agentes anteriores al login Cognito, en solo lectura." />
      <div className="pernexium-card mb-4 p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {campaignsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <SearchableSelect label="Campaña" options={campaigns.map((c) => ({ value: c, label: c }))} value={campaign} onChange={setCampaign} />
          )}
          <SearchableSelect
            label="Agente legado"
            options={agentOptions}
            value={agent}
            onChange={(a) => {
              setAgent(a);
              setPage(1);
            }}
            disabled={!campaign}
            emptyLabel="Todos"
          />
          <div>
            <Label htmlFor="legacy-phone">Teléfono</Label>
            <Input id="legacy-phone" inputMode="numeric" placeholder="5512345678" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} disabled={!campaign} />
          </div>
          <div>
            <Label htmlFor="legacy-from">Desde</Label>
            <Input
              id="legacy-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              disabled={!campaign}
            />
          </div>
          <div>
            <Label htmlFor="legacy-to">Hasta</Label>
            <Input
              id="legacy-to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              disabled={!campaign}
            />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {agent && <FilterPill label={`Agente: ${agent} (Legacy)`} onRemove={() => setAgent(null)} />}
            {phoneInput && <FilterPill label={`Teléfono: ${phoneInput}`} onRemove={() => setPhoneInput('')} />}
            {from && <FilterPill label={`Desde: ${from}`} onRemove={() => setFrom('')} />}
            {to && <FilterPill label={`Hasta: ${to}`} onRemove={() => setTo('')} />}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAgent(null);
                setPhoneInput('');
                setFrom('');
                setTo('');
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        )}
        {campaignsError && <InlineMessage className="mt-3">{campaignsError}</InlineMessage>}
      </div>
      {error && <InlineMessage className="mb-3">{error}</InlineMessage>}

      <div className="pernexium-card p-4">
        {!campaign ? (
          <p className="text-sm text-text-light">Elige una campaña para buscar.</p>
        ) : loading && !result ? (
          <SkeletonRows rows={6} cols={4} />
        ) : !result || result.total === 0 ? (
          <p className="text-sm text-text-light">Sin conversaciones</p>
        ) : (
          <>
            <TableContainer>
              <table className="w-full min-w-[700px] text-left text-sm" aria-busy={loading}>
                <thead className="bg-neutral-30 text-xs uppercase tracking-wider text-text-light">
                  <tr>
                    <th className="px-3 py-3">Agente</th>
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Mensajes</th>
                    <th className="px-3 py-3">Último mensaje</th>
                    <th className="px-3 py-3">
                      <span className="sr-only">Abrir</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.conversations.map((c) => (
                    <tr key={`${c.agent}/${c.phone}`} className="border-t border-neutral-40" data-testid={`conv-${c.agent}-${c.phone}`}>
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs">{c.agent}</span>{' '}
                        <Badge variant="muted" title={LEGACY_NOTE}>
                          Legacy
                        </Badge>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{c.phone}</td>
                      <td className="px-3 py-3">{c.totalMessages}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{mxDateTime(c.lastMessageAt)}</td>
                      <td className="px-3 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setOpen({ agent: c.agent, phone: c.phone })}>
                          Ver conversación
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableContainer>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-text-light">
                <span>
                  Página {result.page} de {pages} · {result.total} conversaciones
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Anterior
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
