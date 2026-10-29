/**
 * Aviso de actualización en la ventana manual (add-in-session-updates).
 *
 * `renderAnaUpdateBanner(view)` es autocontenida (se inyecta con
 * `page.evaluate`): tarjeta fija arriba al centro, sin botones y con
 * `pointer-events:none`, así que no bloquea la ventana ni se puede cerrar.
 * Todo texto variable va con `textContent` (dom-safety). `view = null` lo quita.
 * `bannerView(state)` traduce el estado del actualizador a textos en español.
 */

import { withTimeout, UI_TIMEOUT_MS } from './liveness.js';

export const UPDATE_BANNER_ID = 'ana-update-banner';

export function renderAnaUpdateBanner(view) {
  const ID = 'ana-update-banner';
  const old = document.getElementById(ID);
  if (!view) {
    if (old) old.remove();
    return;
  }
  const error = view.tone === 'error';
  const accent = error ? '#ffb4b4' : '#4fc3f7';
  const el = (tag, style, text) => {
    const n = document.createElement(tag);
    n.style.cssText = style;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const card = el(
    'div',
    [
      'position:fixed',
      'top:14px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483645',
      'pointer-events:none',
      'width:440px',
      'max-width:92vw',
      'box-sizing:border-box',
      'padding:14px 18px',
      'border-radius:14px',
      'background:' + (error ? '#5c1a1a' : '#0b3d91'),
      'border:2px solid ' + accent,
      'color:#fff',
      'font-family:Arial, sans-serif',
      'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
    ].join(';'),
  );
  card.id = ID;
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  const row = el('div', 'display:flex;align-items:center;gap:10px;');
  row.appendChild(el('div', 'font-size:22px;line-height:1;', error ? '⚠️' : '⬆️'));
  row.appendChild(el('div', 'font-size:15px;font-weight:bold;color:' + accent + ';', view.title || ''));
  card.appendChild(row);
  if (view.detail) card.appendChild(el('div', 'margin-top:6px;font-size:13px;line-height:1.35;', view.detail));
  if (typeof view.pct === 'number') {
    const pct = Math.max(0, Math.min(100, Math.round(view.pct)));
    const track = el('div', 'margin-top:10px;height:8px;border-radius:6px;background:rgba(255,255,255,0.2);overflow:hidden;');
    track.appendChild(el('div', 'height:100%;width:' + pct + '%;background:' + accent + ';transition:width .3s;'));
    card.appendChild(track);
  }
  if (view.note) card.appendChild(el('div', 'margin-top:8px;font-size:12px;opacity:0.8;', view.note));
  if (old) old.replaceWith(card);
  else (document.body || document.documentElement).appendChild(card);
}

const KEEP_WORKING = 'Puedes seguir respondiendo chats; los envíos automáticos están en pausa.';

/** Estado del actualizador → vista del aviso (o null). */
export function bannerView(st) {
  if (!st) return null;
  const title = `Nueva versión ${st.version} — se actualizará automáticamente`;
  switch (st.phase) {
    case 'pausing':
      return { title, detail: 'Terminando el envío en curso…', note: KEEP_WORKING };
    case 'downloading':
      return { title, detail: `Descargando actualización… ${st.pct ?? 0}%`, pct: st.pct ?? 0, note: KEEP_WORKING };
    case 'restarting':
      return { title, detail: `Reiniciando para actualizar en ${st.secondsLeft} s`, note: 'ANA se cerrará y volverá a abrirse sola.' };
    case 'installing':
      return { title, detail: 'Instalando… ANA se cerrará y volverá a abrirse sola.' };
    case 'error':
      return {
        tone: 'error',
        title: `No se pudo actualizar a la versión ${st.version}`,
        detail: `${st.message || 'Error desconocido'}. Los envíos continúan; se reintentará en 30 min.`,
      };
    case 'previous-failed':
      return {
        tone: 'error',
        title: `No se pudo instalar la versión ${st.version}`,
        detail: `El instalador terminó con código ${st.exitCode ?? '?'}. Sigues en la versión ${st.current}.`,
        note: `Detalle en %APPDATA%\\ANA\\update.log`,
      };
    default:
      return null;
  }
}

/** Dibuja (o quita) el aviso en una página; nunca lanza ni se cuelga. */
export async function showUpdateBanner(page, view) {
  if (!page) return false;
  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return false;
    await withTimeout(page.evaluate(renderAnaUpdateBanner, view ?? null), UI_TIMEOUT_MS, 'update-banner');
    return true;
  } catch {
    return false;
  }
}
