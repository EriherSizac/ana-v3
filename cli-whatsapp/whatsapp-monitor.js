import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { loadAgentConfig, saveAgentConfig, insertInteractions, normalizePhoneForBackend, searchClientInfoByPhone } from './agent-config.js';

let monitorBrowser = null;
let monitorPage = null;
let processedPhones = new Set();
let monitorLoopInterval = null;
let monitorBusy = false;
let lastFirstChatDataId = '';

async function showMonitorLoginOverlay(requireAll = true) {
  return new Promise(async (resolve) => {
    const savedConfig = loadAgentConfig();

    await monitorPage.evaluate((args) => {
      const { requireAll, savedUser, savedCampaign } = args;

      const existing = document.getElementById('monitor-login-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'monitor-login-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        color: white;
      `;

      const userField = requireAll ? `
        <div style="margin-bottom: 20px; text-align: left;">
          <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #25D366;">Usuario</label>
          <input type="text" id="monitor-login-user" value="${savedUser || ''}" placeholder="ej: erick" style="
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #333;
            border-radius: 10px;
            background: #1a1a1a;
            color: white;
            font-size: 16px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.3s;
          " onfocus="this.style.borderColor='#25D366'" onblur="this.style.borderColor='#333'">
        </div>
      ` : '';

      const campaignField = requireAll ? `
        <div style="margin-bottom: 20px; text-align: left;">
          <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #25D366;">Campaña</label>
          <input type="text" id="monitor-login-campaign" value="${savedCampaign || ''}" placeholder="ej: prueba" style="
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #333;
            border-radius: 10px;
            background: #1a1a1a;
            color: white;
            font-size: 16px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.3s;
          " onfocus="this.style.borderColor='#25D366'" onblur="this.style.borderColor='#333'">
        </div>
      ` : `
        <div style="margin-bottom: 20px; text-align: left;">
          <p style="font-size: 14px; opacity: 0.7;">Usuario: <strong style="color: #25D366;">${savedUser}</strong></p>
          <p style="font-size: 14px; opacity: 0.7;">Campaña: <strong style="color: #25D366;">${savedCampaign}</strong></p>
        </div>
      `;

      overlay.innerHTML = `
        <div style="text-align: center; padding: 40px; background: rgba(30, 30, 30, 0.95); border-radius: 20px; border: 2px solid #25D366; min-width: 400px;">
          <div style="font-size: 60px; margin-bottom: 20px;">🔐</div>
          <h1 style="margin: 0 0 10px 0; font-size: 28px; color: #25D366;">${requireAll ? 'Iniciar Sesión (Monitor)' : 'Verificación Diaria'}</h1>
          <p style="margin: 0 0 30px 0; font-size: 14px; opacity: 0.7;">Ventana de monitoreo (No leídos)</p>

          ${userField}
          ${campaignField}

          <div style="margin-bottom: 30px; text-align: left;">
            <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #25D366;">Palabra del Día</label>
            <input type="password" id="monitor-login-daily-password" placeholder="Ingresa la palabra del día" style="
              width: 100%;
              padding: 12px 15px;
              border: 2px solid #333;
              border-radius: 10px;
              background: #1a1a1a;
              color: white;
              font-size: 16px;
              box-sizing: border-box;
              outline: none;
              transition: border-color 0.3s;
            " onfocus="this.style.borderColor='#25D366'" onblur="this.style.borderColor='#333'">
          </div>

          <button id="monitor-login-submit-btn" style="
            width: 100%;
            padding: 15px;
            background: #25D366;
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.3s;
          " onmouseover="this.style.background='#1da851'" onmouseout="this.style.background='#25D366'">
            Verificar Credenciales
          </button>

          <p id="monitor-login-error" style="margin: 15px 0 0 0; font-size: 14px; color: #ff6b6b; display: none;"></p>
          <p id="monitor-login-loading" style="margin: 15px 0 0 0; font-size: 14px; color: #25D366; display: none;">Verificando...</p>
        </div>
      `;

      document.body.appendChild(overlay);

      setTimeout(() => {
        const firstInput = requireAll ? document.getElementById('monitor-login-user') : document.getElementById('monitor-login-daily-password');
        if (firstInput) firstInput.focus();
      }, 100);
      if (savedUser) window.__savedUser = savedUser;
      if (savedCampaign) window.__savedCampaign = savedCampaign;
    }, { requireAll, savedUser: savedConfig?.agent_id, savedCampaign: savedConfig?.campaign });

    // Exponer función de verificación (idempotente: en recargas puede estar ya expuesta)
    try {
      await monitorPage.exposeFunction('verifyMonitorCredentialsBackend', async (user, campaign, dailyPassword) => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimeout(() => {
          try {
            ctrl?.abort();
          } catch (_) {
            // ignore
          }
        }, 15000);

        try {
          const response = await fetch(`${CONFIG.apiBaseUrl}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, campaign, dailyPassword }),
            signal: ctrl?.signal,
          });
          const data = await response.json().catch(() => ({}));
          return data;
        } catch (error) {
          return { success: false, message: 'Error de conexión/timeout con el servidor' };
        } finally {
          clearTimeout(timeout);
        }
      });
    } catch (e) {
      // ignore
    }

    const checkSubmit = async () => {
      await monitorPage.evaluate((requireAll) => {
        return new Promise((innerResolve) => {
          const btn = document.getElementById('monitor-login-submit-btn');
          const userInput = document.getElementById('monitor-login-user');
          const campaignInput = document.getElementById('monitor-login-campaign');
          const dailyPasswordInput = document.getElementById('monitor-login-daily-password');
          const errorEl = document.getElementById('monitor-login-error');
          const loadingEl = document.getElementById('monitor-login-loading');

          if (!btn || btn.dataset.listenerAdded) return innerResolve(null);

          btn.dataset.listenerAdded = 'true';

          const handleSubmit = async () => {
            const user = requireAll ? userInput.value.trim() : window.__savedUser;
            const campaign = requireAll ? campaignInput.value.trim() : window.__savedCampaign;
            const dailyPassword = dailyPasswordInput.value.trim();

            if (requireAll && (!user || !campaign)) {
              errorEl.textContent = 'Por favor completa todos los campos';
              errorEl.style.display = 'block';
              return;
            }

            if (!dailyPassword) {
              errorEl.textContent = 'Por favor ingresa la palabra del día';
              errorEl.style.display = 'block';
              return;
            }

            errorEl.style.display = 'none';
            loadingEl.style.display = 'block';
            btn.disabled = true;
            btn.style.opacity = '0.5';

            let result = null;
            try {
              if (!window.verifyMonitorCredentialsBackend) {
                throw new Error('verifyMonitorCredentialsBackend no disponible');
              }

              // Timeout extra del lado del browser por si la promesa se cuelga
              result = await Promise.race([
                window.verifyMonitorCredentialsBackend(user, campaign, dailyPassword),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout de verificación')), 20000)),
              ]);
            } catch (err) {
              result = { success: false, message: err && err.message ? err.message : String(err) };
            }

            loadingEl.style.display = 'none';
            btn.disabled = false;
            btn.style.opacity = '1';

            if (result && result.success) {
              window.__monitorLoginResult = { agent_id: user, campaign: campaign };
              const overlay = document.getElementById('monitor-login-overlay');
              if (overlay) overlay.remove();
            } else {
              errorEl.textContent = (result && result.message) ? result.message : 'Credenciales incorrectas';
              errorEl.style.display = 'block';
            }
          };

          btn.addEventListener('click', handleSubmit);

          const inputs = [dailyPasswordInput];
          if (requireAll) inputs.push(userInput, campaignInput);

          inputs.forEach((input) => {
            if (!input) return;
            input.addEventListener('keypress', (e) => {
              if (e.key === 'Enter') handleSubmit();
            });
          });

          innerResolve(null);
        });
      }, requireAll);

      const pollResult = setInterval(async () => {
        try {
          const loginResult = await monitorPage.evaluate(() => window.__monitorLoginResult);
          if (loginResult) {
            clearInterval(pollResult);
            resolve(loginResult);
          }
        } catch (err) {
          clearInterval(pollResult);
        }
      }, 200);
    };

    if (!requireAll && savedConfig) {
      await monitorPage.evaluate((config) => {
        window.__savedUser = config.agent_id;
        window.__savedCampaign = config.campaign;
      }, savedConfig);
    }

    checkSubmit();
  });
}

async function getCampaignNameForInteractions() {
  const agentConfig = loadAgentConfig();
  const rawCampaign = agentConfig?.campaign || '';
  return rawCampaign.includes('-') ? rawCampaign.split('-').slice(1).join('-') : rawCampaign;
}

async function pickFirstUnreadChatCandidate() {
  if (!monitorPage || monitorPage.isClosed()) return null;
  try {
    const candidate = await monitorPage.evaluate(() => {
      const matchesUnread = (row) => {
        try {
          if (!row) return false;
          const a = row.querySelector('[aria-label*="mensajes no leídos"], [aria-label*="unread"], [aria-label*="No leídos"], [aria-label*="No leidos"], span[aria-label*="unread"], span[aria-label*="mensajes no leídos"]');
          if (a) return true;
          const badge = row.querySelector('span[aria-label][role], span[aria-label]');
          if (badge) {
            const t = String(badge.getAttribute('aria-label') || '').toLowerCase();
            if (t.includes('no le') || t.includes('unread')) return true;
          }
          const txt = (row.textContent || '').toLowerCase();
          if (txt.includes('no leídos') || txt.includes('no leidos') || txt.includes('unread')) return true;
          return false;
        } catch (e) {
          return false;
        }
      };

      const rows = Array.from(document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]'));
      for (const row of rows) {
        if (!matchesUnread(row)) continue;

        const dataId = row.getAttribute('data-id') || '';
        if (!dataId) continue;

        try {
          row.scrollIntoView({ block: 'center' });
          row.click();
        } catch (e) {
          // ignore
        }

        return { dataId };
      }

      return null;
    });

    if (!candidate?.dataId) return null;
    return candidate;
  } catch (e) {
    return null;
  }
}

function parsePhoneFromDataId(dataId) {
  const s = String(dataId || '');
  const m1 = s.match(/_(\d{10,15})@/);
  if (m1?.[1]) return m1[1];
  const m2 = s.match(/_(\d{10,15})/);
  if (m2?.[1]) return m2[1];
  return '';
}

async function monitorUnreadLoop() {
  if (monitorBusy) return;
  monitorBusy = true;
  try {
    const agentConfig = loadAgentConfig();
    if (!agentConfig) return;

    // Si está visible el overlay de login, no interferir
    try {
      const hasLoginOverlay = await monitorPage.evaluate(() => Boolean(document.getElementById('monitor-login-overlay')));
      if (hasLoginOverlay) return;
    } catch (e) {
      // ignore
    }

    try {
      await monitorPage.evaluate(() => {
        if (window.__anaClickUnread) window.__anaClickUnread();
      });
    } catch (e) {
      // ignore
    }

    const campaignName = await getCampaignNameForInteractions();
    const candidate = await monitorPage.evaluate(() => {
      try {
        const rows = Array.from(document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]'));
        const first = rows[0];
        if (!first) return null;
        const dataId = first.getAttribute('data-id') || '';
        if (!dataId) return null;
        try {
          first.scrollIntoView({ block: 'center' });
          first.click();
        } catch (e) {
          // ignore
        }
        return { dataId };
      } catch (e) {
        return null;
      }
    });

    if (!candidate?.dataId) return;
    if (candidate.dataId === lastFirstChatDataId) return;
    lastFirstChatDataId = candidate.dataId;

    const phoneRaw = parsePhoneFromDataId(candidate.dataId);
    const phoneE164 = normalizePhoneForBackend(phoneRaw);
    const phoneDigits = String(phoneE164 || '').replace(/\D/g, '');
    const phone10 = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
    if (!phone10) return;

    if (processedPhones.has(phone10)) return;

    const clientInfo = await searchClientInfoByPhone(campaignName, phoneE164);
    const first = Array.isArray(clientInfo) ? clientInfo[0] : null;
    const creditId = first?.credit_info?.credit_id || '';
    if (!creditId) {
      processedPhones.add(phone10);
      console.log(`⚠️  [Monitor] Sin crédito para teléfono ${phoneE164}. Marcado como procesado para no duplicar.`);
      return;
    }

    const INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';
    const now = new Date();
    const contact_date = now.toISOString().slice(0, 10);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');

    const subdictamen = 'CLIENTE NO DEFINE';
    const interactionRes = await insertInteractions([
      {
        credit_id: String(creditId),
        campaign_name: String(campaignName || ''),
        user_id: INTERACTIONS_USER_ID,
        subdictamen,
        contact_date,
        contact_time: `${hh}:${mm}`,
        range_time: `${hh}:00 - ${nextH}:00`,
        action_channel: 'whatsapp',
        action: 'whatsapp',
        contactable: true,
        phone_number: phone10,
        email_address: null,
        template_used: null,
        comments: 'Monitor: respuesta detectada en No leídos',
        promise_date: null,
        promise_amount: null,
        promise_payment_plan: null,
        inoutbound: 'inbound',
        payment_made_date: null,
      },
    ]);

    if (interactionRes?.ok) {
      processedPhones.add(phone10);
      console.log(`✅ [Monitor] Interacción enviada (${phoneE164}) subdictamen='${subdictamen}' credit_id='${creditId}'`);
    } else {
      console.error(`❌ [Monitor] Interacción NO enviada (${phoneE164}) subdictamen='${subdictamen}' credit_id='${creditId}'`);
      if (interactionRes?.status) console.error(`   Status: ${interactionRes.status}`);
      if (interactionRes?.body) console.error(`   Body: ${JSON.stringify(interactionRes.body)}`);
      if (interactionRes?.error) console.error(`   Error: ${interactionRes.error}`);
    }
  } finally {
    monitorBusy = false;
  }
}

async function applyMonitorUIRestrictions() {
  if (!monitorPage || monitorPage.isClosed()) return;
  await monitorPage.evaluate(() => {
    // Instalador de helpers de bloqueo. No se aplica automáticamente.
    window.__anaEnableMonitorLock = () => {
      try {
        const styleId = 'ana-monitor-lock-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            body.ana-monitor-hardlock {
              user-select: none !important;
              -webkit-user-select: none !important;
            }

            #ana-monitor-lock-overlay {
              position: fixed;
              inset: 0;
              background: rgba(0, 0, 0, 0.10);
              z-index: 2147483000;
              pointer-events: auto !important;
              cursor: not-allowed;
            }

            #monitor-login-overlay,
            #monitor-login-overlay * {
              pointer-events: auto !important;
              user-select: text !important;
              -webkit-user-select: text !important;
              z-index: 2147483647 !important;
            }
          `;
          document.head.appendChild(style);
        }

        document.body.classList.add('ana-monitor-hardlock');

        // Overlay real para capturar clicks (más confiable que solo CSS)
        if (!document.getElementById('ana-monitor-lock-overlay')) {
          const ov = document.createElement('div');
          ov.id = 'ana-monitor-lock-overlay';
          ov.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }, true);
          ov.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }, true);
          ov.addEventListener('mouseup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }, true);
          ov.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }, true);
          ov.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }, true);
          ov.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }, true);
          document.body.appendChild(ov);
        }

        window.__anaMonitorLocked = true;
      } catch (e) {
        // ignore
      }
    };

    window.__anaDisableMonitorLock = () => {
      try {
        document.body.classList.remove('ana-monitor-hardlock');
        const ov = document.getElementById('ana-monitor-lock-overlay');
        if (ov) ov.remove();
        window.__anaMonitorLocked = false;
      } catch (e) {
        // ignore
      }
    };

    // Back-compat: código viejo puede llamar esto
    window.applyMonitorUIRestrictions = () => {
      try {
        if (window.__anaMonitorLocked && window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
      } catch (e) {
        // ignore
      }
    };

    const allowUnreadOnly = () => {
      try {
        // Quitar marcas previas (si el DOM cambió)
        document.querySelectorAll('.ana-allow-unread').forEach((el) => {
          el.classList.remove('ana-allow-unread');
        });

        // Localizar el span exacto por texto ("No leídos" / "No leidos" / "Unread")
        const spans = Array.from(document.querySelectorAll('span'));
        const target = spans.find((s) => {
          const t = (s.textContent || '').trim().toLowerCase();
          return t === 'no leídos' || t === 'no leidos' || t === 'unread';
        });
        if (!target) return;

        // Marcar el span y su contenedor clickeable
        target.classList.add('ana-allow-unread');
        const clickable = target.closest('button,[role="button"],a,div[role="button"],li[role="button"]') || target.parentElement;
        if (clickable) {
          clickable.classList.add('ana-allow-unread');
          try { clickable.style.cursor = 'pointer'; } catch (_) {}
        }
      } catch (e) {
        // ignore
      }
    };

    const clickUnread = () => {
      // Si hay overlay de login, no intentar manipular filtros
      if (document.getElementById('monitor-login-overlay')) return;

      // Asegurar que el único elemento clickeable sea el filtro
      allowUnreadOnly();

      try {
        const spans = Array.from(document.querySelectorAll('span'));
        const labelEl = spans.find((s) => {
          const t = (s.textContent || '').trim().toLowerCase();
          return t === 'no leídos' || t === 'no leidos' || t === 'unread';
        });
        if (!labelEl) return;

        // En WhatsApp web suele ser un chip/tab; el clickable suele tener role=tab o role=button
        const clickable =
          labelEl.closest('[role="tab"],button,[role="button"],a,div[role="button"],li[role="button"]') ||
          labelEl.parentElement;
        if (!clickable) return;

        const ariaSelected = String(clickable.getAttribute('aria-selected') || '').toLowerCase();
        const dataSelected = String(clickable.getAttribute('data-selected') || '').toLowerCase();
        if (ariaSelected === 'true' || dataSelected === 'true') return;

        try {
          clickable.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {
          // ignore
        }

        const fire = (type) => {
          try {
            clickable.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse' }));
          } catch (_) {
            // ignore
          }
          try {
            clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
          } catch (_) {
            // ignore
          }
        };

        // Secuencia completa: WhatsApp a veces ignora el .click() si no hubo pointer events
        fire('pointerdown');
        fire('mousedown');
        fire('mouseup');
        fire('pointerup');
        fire('click');

        // Fallback final
        try {
          clickable.click();
        } catch (_) {
          // ignore
        }
      } catch (e) {
        // ignore
      }
    };

    // Exponer para poder invocarlo desde Node cuando el DOM se reinicia tras login
    window.__anaClickUnread = clickUnread;
    window.__anaAllowUnreadOnly = allowUnreadOnly;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        allowUnreadOnly();
        setTimeout(clickUnread, 1200);
      });
    } else {
      allowUnreadOnly();
      setTimeout(clickUnread, 1200);
    }

    setInterval(() => {
      try {
        allowUnreadOnly();
        clickUnread();
      } catch (e) {
        // ignore
      }
    }, 1500);

    const observer = new MutationObserver(() => {
      try {
        clickUnread();
      } catch (e) {
        // ignore
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      });
    }
  });
}

export async function initMonitorWhatsApp() {
  console.log(' Iniciando ventana monitor de WhatsApp (No leídos)...');

  const monitorArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-tools',
  ];

  // Por defecto abrir el monitor en modo app (sin barra de navegador/menús)
  // Para desactivarlo: npm run start -- --monitor-no-app
  if (!process.argv.includes('--monitor-no-app')) {
    monitorArgs.push('--app=https://web.whatsapp.com');
  }

  monitorBrowser = await chromium.launchPersistentContext(CONFIG.monitorSessionPath, {
    headless: false,
    args: monitorArgs,
    viewport: { width: 1280, height: 720 },
    devtools: false,
  });

  monitorPage = monitorBrowser.pages()[0] || await monitorBrowser.newPage();

  await monitorPage.addInitScript(() => {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.metaKey && e.altKey && e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.metaKey && e.altKey && e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.metaKey && e.altKey && e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);

    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, true);
  });

  await monitorPage.addInitScript(() => {
    const boot = () => {
      try {
        async function applyMonitorUIRestrictions() {
          // Bloqueo UI del monitor deshabilitado temporalmente por estabilidad
          // (primero asegurar overlay login + auto "No leídos")
          return;
        }
        const allowUnreadOnly = () => {
          try {
            document.querySelectorAll('.ana-allow-unread').forEach((el) => el.classList.remove('ana-allow-unread'));
            const spans = Array.from(document.querySelectorAll('span'));
            const target = spans.find((s) => {
              const t = (s.textContent || '').trim().toLowerCase();
              return t === 'no leídos' || t === 'no leidos' || t === 'unread';
            });
            if (!target) return;
            target.classList.add('ana-allow-unread');
            const clickable = target.closest('button,[role="button"],a,div[role="button"],li[role="button"]') || target.parentElement;
            if (clickable) {
              clickable.classList.add('ana-allow-unread');
              try { clickable.style.cursor = 'pointer'; } catch (_) {}
            }
          } catch (e) {
            // ignore
          }
        };

        const clickUnread = () => {
          if (document.getElementById('monitor-login-overlay')) return;
          allowUnreadOnly();
          try {
            const spans = Array.from(document.querySelectorAll('span'));
            const labelEl = spans.find((s) => {
              const t = (s.textContent || '').trim().toLowerCase();
              return t === 'no leídos' || t === 'no leidos' || t === 'unread';
            });
            if (!labelEl) return;

            const clickable =
              labelEl.closest('[role="tab"],button,[role="button"],a,div[role="button"],li[role="button"]') ||
              labelEl.parentElement;
            if (!clickable) return;

            const ariaSelected = String(clickable.getAttribute('aria-selected') || '').toLowerCase();
            const dataSelected = String(clickable.getAttribute('data-selected') || '').toLowerCase();
            if (ariaSelected === 'true' || dataSelected === 'true') return;

            clickable.click();
          } catch (e) {
            // ignore
          }
        };

        window.__anaAllowUnreadOnly = allowUnreadOnly;
        window.__anaClickUnread = clickUnread;

        const isConnected = () => {
          try {
            return Boolean(document.querySelector('#side, #pane-side'));
          } catch (_) {
            return false;
          }
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            try {
              if (!isConnected()) return;
              allowUnreadOnly();
              setTimeout(clickUnread, 1200);
            } catch (_) {}
          });
        } else {
          try {
            if (isConnected()) {
              allowUnreadOnly();
              setTimeout(clickUnread, 1200);
            }
          } catch (_) {}
        }

        setInterval(() => {
          try {
            if (!isConnected()) return;
            allowUnreadOnly();
            clickUnread();
          } catch (_) {
            // ignore
          }
        }, 1500);

        const observer = new MutationObserver(() => {
          try {
            if (!isConnected()) return;
            allowUnreadOnly();
          } catch (_) {
            // ignore
          }
        });

        if (document.documentElement) {
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (e) {
        // ignore
      }
    };

    try {
      boot();
    } catch (e) {
      // ignore
    }
  });

  // Instalar helpers de No-leídos y de bloqueo (pero NO bloquear todavía)
  await applyMonitorUIRestrictions();

  // WhatsApp Web mantiene conexiones abiertas; 'networkidle' puede quedarse colgado.
  // Usar 'domcontentloaded' para evitar pantallas de carga eternas.
  await monitorPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Watchdog: si no aparece sidebar ni QR, recargar (a veces se queda en splash).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await monitorPage.waitForSelector('#side, #pane-side, canvas, [data-testid="qrcode"], [aria-label*="código"], [aria-label*="qr"], [aria-label*="code"]', { timeout: 30000 });
      break;
    } catch (e) {
      console.log(`⚠️  [Monitor] WhatsApp quedó en carga (sin sidebar/QR). Recargando (${attempt + 1}/3)...`);
      try {
        await monitorPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (_) {
        try {
          await monitorPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (_) {
          // ignore
        }
      }
    }
  }

  // Fallback final: si ya estamos en UI y ya intentamos seleccionar "No leídos", bloquear de todas formas.
  // (En algunos builds no hay señal confiable de seleccionado.)
  try {
    await monitorPage.evaluate(() => {
      try {
        window.__anaMonitorLocked = true;
        if (window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
      } catch (e) {
        // ignore
      }
    });
    console.log('🔒 [Monitor] Bloqueo activado (fallback final)');
  } catch (e) {
    // ignore
  }

  console.log('🔐 Validación de credenciales requerida (Monitor)...');
  console.log('📝 Ingresa usuario, campaña y palabra del día');

  const monitorConfig = await showMonitorLoginOverlay(true);
  saveAgentConfig(monitorConfig);
  console.log(`✅ Credenciales verificadas (Monitor): ${monitorConfig.agent_id} | Campaña: ${monitorConfig.campaign}`);

  console.log('📱 Escanea el código QR con OTRO teléfono/cuenta');
  console.log('⏳ Esperando conexión de WhatsApp Web (Monitor)...');

  // A veces WhatsApp se queda en pantalla de carga (logo/barra) y no termina de renderizar #side.
  // Reintentar con recarga suave.
  let connected = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await monitorPage.waitForSelector('#side, #pane-side', { timeout: 120000 });
      connected = true;
      break;
    } catch (e) {
      try {
        console.log(`⚠️  [Monitor] No cargó #side (intento ${attempt + 1}/3). Recargando...`);
        await monitorPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (_) {
        // ignore
      }
    }
  }

  if (!connected) {
    throw new Error('Monitor: WhatsApp Web no terminó de cargar (#side/#pane-side no apareció)');
  }

  console.log('✅ WhatsApp Web (Monitor) conectado - Ventana lista!');

  // Fallback fuerte: click real con Playwright al tab "No leídos" si existe.
  // (Hay builds de WhatsApp que ignoran element.click()/dispatchEvent)
  try {
    const unreadTab = monitorPage.getByRole('tab', { name: /no le[ií]dos|unread/i }).first();
    await unreadTab.waitFor({ timeout: 5000 });
    await unreadTab.click({ timeout: 5000 });
    const selected = await unreadTab.getAttribute('aria-selected');
    console.log(`👀 [Monitor] Playwright click tab No leídos aria-selected=${selected}`);

    // En algunos builds el tab no expone aria-selected; si el click no lanza error,
    // asumimos que el filtro cambió y activamos bloqueo.
    try {
      await monitorPage.waitForTimeout(700);
    } catch (_) {
      // ignore
    }
    await monitorPage.evaluate(() => {
      try {
        window.__anaMonitorLocked = true;
        if (window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
      } catch (e) {
        // ignore
      }
    });
    console.log('🔒 [Monitor] Bloqueo activado (solo observación)');
  } catch (e) {
    // ignore
  }

  // Forzar navegación al filtro de "No leídos/Unread" una vez que la sesión ya está conectada.
  // (Después del login el DOM puede reiniciarse y los intervalos iniciales pueden no bastar.)
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const shouldPoll = await monitorPage.evaluate(() => {
        const side = document.querySelector('#side, #pane-side');
        return Boolean(side);
      });

      if (shouldPoll) {
        const diag = await monitorPage.evaluate(() => {
          try {
            if (window.__anaAllowUnreadOnly) window.__anaAllowUnreadOnly();

            const spans = Array.from(document.querySelectorAll('span'));
            const target = spans.find((s) => {
              const t = (s.textContent || '').trim().toLowerCase();
              return t === 'no leídos' || t === 'no leidos' || t === 'unread';
            });

            const clickable = target ? (target.closest('[role="tab"],button,[role="button"],a,div[role="button"],li[role="button"]') || target.parentElement) : null;
            const canClick = Boolean(clickable);

            if (window.__anaClickUnread) window.__anaClickUnread();

            const ariaSelectedAfter = clickable ? String(clickable.getAttribute('aria-selected') || '') : '';

            // Si ya quedó seleccionado, activar bloqueo (si aún no estaba)
            if (String(ariaSelectedAfter || '').toLowerCase() === 'true') {
              try {
                window.__anaMonitorLocked = true;
                if (window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
              } catch (e) {
                // ignore
              }
            }

            return {
              foundUnread: Boolean(target),
              canClick,
              ariaSelected: ariaSelectedAfter,
              targetText: target ? (target.textContent || '').trim() : null,
            };
          } catch (e) {
            return { error: String(e && e.message ? e.message : e) };
          }
        });

        console.log(`👀 [Monitor] clickUnread diag intento ${attempt + 1}/12:`, diag);
      }
    } catch (e) {
      // ignore
    }
    try {
      await monitorPage.waitForTimeout(500);
    } catch (e) {
      break;
    }
  }

  await monitorPage.evaluate(() => {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.metaKey && e.altKey && e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.metaKey && e.altKey && e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.metaKey && e.altKey && e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);

    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, true);

    // UI restrictions intentionally disabled for now
  });

  await monitorPage.waitForTimeout(2000);

  processedPhones = new Set();
  if (monitorLoopInterval) {
    try {
      clearInterval(monitorLoopInterval);
    } catch (e) {
      // ignore
    }
  }
  monitorLoopInterval = setInterval(() => {
    monitorUnreadLoop().catch(() => null);
  }, 2500);
}

export async function closeMonitorBrowser() {
  if (monitorBrowser) {
    console.log('🔒 Cerrando navegador monitor...');
    if (monitorLoopInterval) {
      try {
        clearInterval(monitorLoopInterval);
      } catch (e) {
        // ignore
      }
      monitorLoopInterval = null;
    }
    await monitorBrowser.close();
  }
}

export function getMonitorPage() {
  return monitorPage;
}
