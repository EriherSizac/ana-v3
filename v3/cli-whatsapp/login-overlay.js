/**
 * Overlay de login Cognito en la página de automatización (design D8).
 *
 * `renderAnaLogin(view)` es autocontenida: se inyecta por su código fuente con
 * `loginOverlayScript()` y dibuja la vista que entrega `login-flow.js`. Todo
 * texto variable se asigna con `textContent` (dom-safety). La página solo
 * envía entradas con `window.anaLoginAction(action, input)` (exposeFunction) y
 * vuelve a dibujar la vista devuelta; no guarda contraseñas ni tokens en `window`.
 */

export const LOGIN_OVERLAY_ID = 'login-overlay';

export function renderAnaLogin(view) {
  const ID = 'login-overlay';
  const BLUE = '#0b3d91';
  const ACCENT = '#4fc3f7';
  const old = document.getElementById(ID);
  if (old) old.remove();
  if (!view || view.step === 'done') return;

  const el = (tag, style, text) => {
    const n = document.createElement(tag);
    if (style) n.style.cssText = style;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const inputStyle =
    'width:100%;padding:12px 15px;border:2px solid #1e4fa8;border-radius:10px;background:#071f4d;color:white;font-size:16px;box-sizing:border-box;outline:none;';
  const btnStyle =
    'width:100%;padding:14px;background:' + ACCENT + ';color:#071f4d;border:none;border-radius:10px;font-size:17px;font-weight:bold;cursor:pointer;margin-top:10px;';
  const linkStyle = 'background:none;border:none;color:' + ACCENT + ';font-size:14px;cursor:pointer;margin-top:14px;text-decoration:underline;';

  const overlay = el(
    'div',
    'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(11,61,145,0.97);z-index:9999999;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;color:white;',
  );
  overlay.id = ID;
  const card = el('div', 'text-align:center;padding:36px;background:' + BLUE + ';border-radius:20px;border:2px solid ' + ACCENT + ';width:420px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,0.4);');
  overlay.appendChild(card);
  card.appendChild(el('div', 'font-size:52px;margin-bottom:12px;', '🔐'));

  const titles = {
    login: 'Iniciar Sesión',
    select_mfa: 'Verificación en dos pasos',
    code: 'Verificación en dos pasos',
    setup_totp: 'Configura tu app autenticadora',
    new_password: 'Crea tu contraseña',
    campaign: 'Elige tu campaña',
    active: 'Sesión activa',
    no_campaigns: 'Sin campañas',
  };
  card.appendChild(el('h1', 'margin:0 0 18px 0;font-size:26px;color:' + ACCENT + ';', titles[view.step] || 'Iniciar Sesión'));

  const errorEl = el('p', 'margin:14px 0 0 0;font-size:14px;color:#ffb4b4;min-height:18px;', view.error || '');
  const loadingEl = el('p', 'margin:8px 0 0 0;font-size:14px;color:' + ACCENT + ';display:none;', 'Verificando...');

  const field = (label, type, id, value) => {
    const wrap = el('div', 'margin-bottom:16px;text-align:left;');
    wrap.appendChild(el('label', 'display:block;margin-bottom:6px;font-size:14px;color:' + ACCENT + ';', label));
    const row = el('div', 'display:flex;gap:8px;align-items:center;');
    const input = el('input', inputStyle + 'flex:1;');
    input.type = type;
    input.id = id;
    input.autocomplete = 'off';
    if (value) input.value = value;
    row.appendChild(input);
    if (type === 'password') {
      const t = el('button', 'padding:12px;background:#071f4d;color:' + ACCENT + ';border:2px solid #1e4fa8;border-radius:10px;cursor:pointer;', 'Ver');
      t.type = 'button';
      t.addEventListener('click', () => {
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        t.textContent = hidden ? 'Ocultar' : 'Ver';
        input.focus();
      });
      row.appendChild(t);
    }
    wrap.appendChild(row);
    card.appendChild(wrap);
    return input;
  };

  let busy = false;
  const act = async (action, input) => {
    if (busy) return;
    busy = true;
    errorEl.textContent = '';
    loadingEl.style.display = 'block';
    let next;
    try {
      next = await window.anaLoginAction(action, input || {});
    } catch (e) {
      next = Object.assign({}, view, { error: 'Error de conexión con el servidor' });
    }
    busy = false;
    window.__anaRenderLogin(next);
  };
  const button = (text, onClick, style) => {
    const b = el('button', style || btnStyle, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    card.appendChild(b);
    return b;
  };
  const onEnter = (inputs, fn) => inputs.forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && fn()));

  const campaignPicker = () => {
    const search = field('Buscar campaña', 'text', 'login-campaign-search', '');
    const select = el('select', inputStyle + 'margin-bottom:6px;');
    select.id = 'login-campaign';
    select.size = Math.min(6, Math.max(2, (view.campaigns || []).length));
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      const current = select.value || view.selected || '';
      while (select.firstChild) select.removeChild(select.firstChild);
      (view.campaigns || [])
        .filter((c) => !q || c.includes(q))
        .forEach((c) => {
          const o = el('option', '', c);
          o.value = c;
          if (c === current) o.selected = true;
          select.appendChild(o);
        });
    };
    search.addEventListener('input', fill);
    fill();
    card.appendChild(select);
    return select;
  };

  if (view.step === 'login') {
    const user = field('Usuario', 'text', 'login-user', view.username || '');
    const pass = field('Contraseña', 'password', 'login-password', '');
    const submit = () => act('login', { username: user.value.trim(), password: pass.value });
    button('Iniciar sesión', submit);
    onEnter([user, pass], submit);
    setTimeout(() => (user.value ? pass : user).focus(), 50);
  } else if (view.step === 'select_mfa') {
    card.appendChild(el('p', 'font-size:14px;opacity:0.85;', 'Elige cómo quieres recibir tu código'));
    (view.options || []).forEach((o) => button(o.label, () => act('select_mfa', { method: o.value })));
    button('Volver', () => act('cancel'), linkStyle);
  } else if (view.step === 'code' || view.step === 'setup_totp') {
    if (view.step === 'setup_totp') {
      card.appendChild(el('p', 'font-size:14px;opacity:0.85;', 'Escanea el código QR con tu app autenticadora o escribe la clave'));
      if (view.qr) {
        const img = el('img', 'width:200px;height:200px;background:white;padding:8px;border-radius:8px;');
        img.src = view.qr;
        img.alt = 'Código QR';
        card.appendChild(img);
      }
      card.appendChild(el('p', 'font-family:monospace;font-size:15px;word-break:break-all;background:#071f4d;padding:8px;border-radius:8px;', view.secret || ''));
    } else {
      const channel = view.channel === 'sms' ? 'Escribe el código que llegó por SMS' + (view.destination ? ' a ' + view.destination : '') : 'Escribe el código de tu app autenticadora';
      card.appendChild(el('p', 'font-size:14px;opacity:0.85;', channel));
    }
    const code = field('Código de 6 dígitos', 'text', 'login-code', '');
    code.inputMode = 'numeric';
    code.maxLength = 6;
    const submit = () => act('code', { code: code.value.trim() });
    button('Verificar', submit);
    onEnter([code], submit);
    button('Volver', () => act('cancel'), linkStyle);
    setTimeout(() => code.focus(), 50);
  } else if (view.step === 'new_password') {
    card.appendChild(el('p', 'font-size:14px;opacity:0.85;', 'Tu contraseña es temporal: define una nueva'));
    const p1 = field('Contraseña nueva', 'password', 'login-new-password', '');
    const p2 = field('Confirma la contraseña', 'password', 'login-new-password-confirm', '');
    const submit = () => act('new_password', { password: p1.value, confirm: p2.value });
    button('Guardar contraseña', submit);
    onEnter([p1, p2], submit);
    setTimeout(() => p1.focus(), 50);
  } else if (view.step === 'campaign' || view.step === 'active') {
    if (view.step === 'active') {
      card.appendChild(el('p', 'font-size:16px;margin:0 0 14px 0;', 'Sesión activa: ' + (view.username || '')));
    } else {
      card.appendChild(el('p', 'font-size:14px;opacity:0.85;margin:0 0 12px 0;', 'Usuario: ' + (view.username || '')));
    }
    if ((view.campaigns || []).length === 0) {
      button('Reintentar', () => act('retry_campaigns'));
    } else {
      const select = campaignPicker();
      button(view.step === 'active' ? 'Continuar' : 'Entrar', () => act(view.step === 'active' ? 'continue' : 'campaign', { campaign: select.value }));
    }
    button('Cambiar de usuario', () => act('switch_user'), linkStyle);
  } else if (view.step === 'no_campaigns') {
    card.appendChild(el('p', 'font-size:15px;', 'Usuario: ' + (view.username || '')));
    button('Cambiar de usuario', () => act('switch_user'), linkStyle);
  }

  card.appendChild(errorEl);
  card.appendChild(loadingEl);
  (document.body || document.documentElement).appendChild(overlay);
}

/** Código para `page.evaluate` / `addInitScript` que define `window.__anaRenderLogin`. */
export function loginOverlayScript() {
  return `window.__anaRenderLogin = (${renderAnaLogin.toString()});`;
}
