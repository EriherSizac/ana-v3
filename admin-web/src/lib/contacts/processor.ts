import { ContactsSession, handleRequest, type CheckSummary, type PlanSummary, type Progress, type ReadInput, type ReadSummary, type WorkerRequest, type WorkerResponse } from './pipeline';
import type { Mode } from './plan';

// Cliente del Worker de contactos (support-crm-base-upload "Procesamiento en
// segundo plano"). Sin `Worker` (pruebas con jsdom, navegadores antiguos) usa
// la misma sesión en el hilo principal.

/** Lo mínimo de `Worker` que se usa (permite un Worker falso en pruebas). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export type ProgressListener = (p: Progress) => void;

export class CancelledError extends Error {
  constructor() {
    super('Procesamiento cancelado');
    this.name = 'CancelledError';
  }
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistOmit<WorkerRequest, 'id'>;

export interface ContactsProcessor {
  read(input: ReadInput, onProgress?: ProgressListener): Promise<ReadSummary | { error: string }>;
  check(phoneChoice: string | null, onProgress?: ProgressListener): Promise<CheckSummary | { error: string }>;
  plan(input: { mode: Mode; enabled: string[]; agent?: string | null }, onProgress?: ProgressListener): Promise<PlanSummary | { error: string }>;
  /** Detiene el trabajo en curso (el Worker se reinicia y pierde el archivo leído). */
  cancel(): void;
  dispose(): void;
}

/** Worker real de Next.js (el bundler resuelve `new URL(..., import.meta.url)`). */
export function defaultWorkerFactory(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./contacts.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
  } catch {
    return null;
  }
}

/**
 * Procesador con Worker si `factory` devuelve uno; si no, en el hilo
 * principal (cediendo el turno antes de cada fase para pintar el progreso).
 */
export function createContactsProcessor(factory: () => WorkerLike | null = defaultWorkerFactory): ContactsProcessor {
  let worker: WorkerLike | null = null;
  let session: ContactsSession | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; onProgress?: ProgressListener }>();

  const onMessage = (res: WorkerResponse) => {
    const p = pending.get(res.id);
    if (!p) return;
    if (res.type === 'progress') {
      p.onProgress?.(res.progress);
      return;
    }
    pending.delete(res.id);
    if (res.type === 'result') p.resolve(res.result);
    else p.reject(new Error(res.message));
  };

  const ensure = () => {
    if (worker || session) return;
    worker = factory();
    if (worker) {
      worker.onmessage = (ev) => onMessage(ev.data as WorkerResponse);
      worker.onerror = () => {
        for (const [, p] of pending) p.reject(new Error('No se pudo procesar el archivo'));
        pending.clear();
      };
    } else {
      session = new ContactsSession();
    }
  };

  const send = <T>(body: Body, onProgress?: ProgressListener, transfer?: Transferable[]): Promise<T> => {
    ensure();
    const id = nextId++;
    const req = { ...body, id } as WorkerRequest;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      if (worker) {
        worker.postMessage(req, transfer);
      } else {
        const s = session!;
        // Cede el turno para que la UI muestre la fase antes de trabajar.
        setTimeout(() => {
          if (!pending.has(id)) return;
          void handleRequest(s, req, onMessage);
        }, 0);
      }
    });
  };

  const cancel = () => {
    for (const [, p] of pending) p.reject(new CancelledError());
    pending.clear();
    worker?.terminate();
    worker = null;
    session = null;
  };

  return {
    read: (input, onProgress) => {
      const transfer = input.bytes ? [input.bytes.buffer as ArrayBuffer] : undefined;
      return send({ type: 'read', input }, onProgress, transfer);
    },
    check: (phoneChoice, onProgress) => send({ type: 'check', phoneChoice }, onProgress),
    plan: (input, onProgress) => send({ type: 'plan', input }, onProgress),
    cancel,
    dispose: cancel,
  };
}
