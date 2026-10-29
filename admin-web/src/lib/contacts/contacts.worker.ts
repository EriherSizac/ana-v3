import { ContactsSession, handleRequest, type WorkerRequest, type WorkerResponse } from './pipeline';

// Web Worker de la carga de contactos (support-crm-base-upload): lee, valida
// y reparte fuera del hilo de la UI. Mantiene el CSV leído entre mensajes.

const scope = self as unknown as { onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null; postMessage: (m: WorkerResponse) => void };
const session = new ContactsSession();

scope.onmessage = (ev) => {
  void handleRequest(session, ev.data, (r) => scope.postMessage(r));
};
