/* eslint-disable @typescript-eslint/no-explicit-any -- parseo defensivo de respuestas externas */
import 'server-only';
import type { UploadHistoryItem } from '@/lib/contacts/history';
import { callUpstream } from '../backends/http';
import { ensureOk } from '../backends/v4';
import { serverEnv } from '../env';

/** Historial v3 (`GET /admin/campaigns/{c}/uploads`) normalizado. */
export async function v3History(token: string, campaign: string): Promise<UploadHistoryItem[]> {
  const { v3ApiBase } = serverEnv();
  const res = await callUpstream<any>(`${v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/uploads`, { token, label: 'v3:uploads' });
  const data = ensureOk(res, 'v3:uploads');
  return (data?.data?.items ?? []).map(
    (m: any): UploadHistoryItem => ({
      fleet: 'v3',
      id: String(m.uploadId ?? ''),
      fileName: String(m.fileName ?? ''),
      uploadedBy: m.uploadedBy ?? null,
      uploadedAt: m.uploadedAt ?? null,
      mode: m.mode ?? null,
      totalRows: typeof m.totalRows === 'number' ? m.totalRows : null,
      validRows: typeof m.totalRows === 'number' ? m.totalRows : null,
      status: m.status === 'completed' ? 'completed' : 'failed',
      reason: null,
      perAgent: (m.perAgent ?? []).map((p: any) => ({ agent: String(p.agent), rows: Number(p.rows) || 0 })),
      ...(m.source !== undefined ? { source: m.source } : {}),
    }),
  );
}

/** Historial v4 (`GET /uploads/history`) normalizado. */
export async function v4History(token: string, campaign: string, srcKey?: string | null): Promise<UploadHistoryItem[]> {
  const { v4ApiBase } = serverEnv();
  const qs = new URLSearchParams({ campaign });
  if (srcKey) qs.set('srcKey', srcKey);
  const res = await callUpstream<any>(`${v4ApiBase}/uploads/history?${qs.toString()}`, { token, label: 'v4:uploads' });
  const data = ensureOk(res, 'v4:uploads');
  return (data?.items ?? []).map(
    (r: any): UploadHistoryItem => ({
      fleet: 'v4',
      id: String(r.srcKey ?? ''),
      fileName: String(r.fileName ?? ''),
      uploadedBy: r.uploadedBy ?? null,
      uploadedAt: r.uploadedAt ?? null,
      mode: r.mode ?? null,
      totalRows: typeof r.totalRows === 'number' ? r.totalRows : null,
      validRows: typeof r.validRows === 'number' ? r.validRows : null,
      status: r.status === 'rejected' ? 'rejected' : 'processed',
      reason: r.reason ?? null,
      perAgent: Object.entries(r.perAgent ?? {}).map(([agent, rows]) => ({ agent, rows: Number(rows) || 0 })),
    }),
  );
}
