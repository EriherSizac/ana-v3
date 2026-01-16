import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import {
  loadAgentConfig,
  saveAgentConfig,
  insertInteractions,
  normalizePhoneForBackend,
  searchClientInfoByPhone,
  INTERACTIONS_API_BASE_URL,
} from './agent-config.js';

let cachedResultCodesByCampaign = new Map();

let monitorBrowser = null;
let monitorPwBrowser = null;
let monitorContext = null;
let monitorPage = null;

let processedPhones = new Set();
let monitorLoopInterval = null;
let monitorBusy = false;
let lastFirstChatDataId = '';

/**
 * LOGIN OVERLAY (igual que el tuyo, solo le dejo guard rails)
 */
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
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        color: white;
      `;

      const userField = requireAll
        ? `
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
      `
        : '';

      const campaignField = requireAll
        ? `
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
      `
        : `
        <div style="margin-bottom: 20px; text-align: left;">
          <p style="font-size: 14px; opacity: 0.7;">Usuario: <strong style="color: #25D366;">${savedUser}</strong></p>
          <p style="font-size: 14px; opacity: 0.7;">Campaña: <strong style="color: #25D366;">${savedCampaign}</strong></p>
        </div>
      `;

      overlay.innerHTML = `
        <div style="text-align: center; padding: 40px; background: rgba(30, 30, 30, 0.95); border-radius: 20px; border: 2px solid #25D366; min-width: 400px;">
          <div style="font-size: 60px; margin-bottom: 20px;">🔐</div>
          <h1 style="margin: 0 0 10px 0; font-size: 28px; color: #25D366;">${
            requireAll ? 'Iniciar Sesión (Monitor)' : 'Verificación Diaria'
          }</h1>
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
        const firstInput = requireAll
          ? document.getElementById('monitor-login-user')
          : document.getElementById('monitor-login-daily-password');
        if (firstInput) firstInput.focus();
      }, 100);

      if (savedUser) window.__savedUser = savedUser;
      if (savedCampaign) window.__savedCampaign = savedCampaign;
    }, { requireAll, savedUser: savedConfig?.agent_id, savedCampaign: savedConfig?.campaign });

    // Exponer función de verificación
    try {
      await monitorPage.exposeFunction('verifyMonitorCredentialsBackend', async (user, campaign, dailyPassword) => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = setTimeout(() => {
          try {
            ctrl?.abort();
          } catch (_) {}
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
    } catch (_) {
      // ignore
    }

    // Instalar listeners dentro del overlay una sola vez
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
            if (!window.verifyMonitorCredentialsBackend) throw new Error('verifyMonitorCredentialsBackend no disponible');
            result = await Promise.race([
              window.verifyMonitorCredentialsBackend(user, campaign, dailyPassword),
              new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout de verificación')), 20000)),
            ]);
          } catch (err) {
            result = { success: false, message: err?.message || String(err) };
          }

          loadingEl.style.display = 'none';
          btn.disabled = false;
          btn.style.opacity = '1';

          if (result && result.success) {
            window.__monitorLoginResult = { agent_id: user, campaign };
            const overlay = document.getElementById('monitor-login-overlay');
            if (overlay) overlay.remove();
          } else {
            errorEl.textContent = result?.message || 'Credenciales incorrectas';
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

    // Poll hasta que el overlay escriba el resultado
    const pollResult = setInterval(async () => {
      try {
        const loginResult = await monitorPage.evaluate(() => window.__monitorLoginResult);
        if (loginResult) {
          clearInterval(pollResult);
          resolve(loginResult);
        }
      } catch (_) {
        clearInterval(pollResult);
      }
    }, 200);
  });
}

async function fetchResultCodesFromBackend(campaignName) {
  if (cachedResultCodesByCampaign.has(campaignName)) {
    return cachedResultCodesByCampaign.get(campaignName);
  }

  const url = `${INTERACTIONS_API_BASE_URL}/result-codes/${encodeURIComponent(campaignName)}`;
  try {
    const response = await fetch(url);
    const rawText = await response.text().catch(() => '');
    const data = rawText ? JSON.parse(rawText) : {};
    const resultCodes = Array.isArray(data.result_codes) ? data.result_codes : [];
    if (!response.ok || resultCodes.length === 0) {
      console.log('[Monitor][result-codes] url=', url);
      console.log('[Monitor][result-codes] status=', response.status);
      console.log('[Monitor][result-codes] body=', rawText);
    }
    cachedResultCodesByCampaign.set(campaignName, resultCodes);
    return resultCodes;
  } catch (error) {
    console.error('❌ [Monitor] Error al obtener result codes:', error.message);
    return [];
  }
}

async function getCampaignNameForInteractions() {
  const agentConfig = loadAgentConfig();
  const rawCampaign = agentConfig?.campaign || '';
  return rawCampaign.includes('-') ? rawCampaign.split('-').slice(1).join('-') : rawCampaign;
}

async function getGestionDataFromBackendForMonitor(campaignName, phoneDigits) {
  const phoneE164 = normalizePhoneForBackend(phoneDigits);
  const [resultCodes, clientInfo] = await Promise.all([
    fetchResultCodesFromBackend(campaignName),
    searchClientInfoByPhone(campaignName, phoneE164),
  ]);
  return { resultCodes, clientInfo, campaignName, phoneE164 };
}

function parsePhoneFromDataId(dataId) {
  const s = String(dataId || '');
  const m1 = s.match(/_(\d{10,15})@/);
  if (m1?.[1]) return m1[1];
  const m2 = s.match(/_(\d{10,15})/);
  if (m2?.[1]) return m2[1];
  return '';
}

async function pickFirstUnreadChatCandidate() {
  if (!monitorPage || monitorPage.isClosed()) return null;

  try {
    const candidate = await monitorPage.evaluate(() => {
      const matchesUnread = (row) => {
        try {
          if (!row) return false;
          const a = row.querySelector(
            '[aria-label*="mensajes no leídos"], [aria-label*="unread"], [aria-label*="No leídos"], [aria-label*="No leidos"], span[aria-label*="unread"], span[aria-label*="mensajes no leídos"]'
          );
          if (a) return true;

          const badge = row.querySelector('span[aria-label][role], span[aria-label]');
          if (badge) {
            const t = String(badge.getAttribute('aria-label') || '').toLowerCase();
            if (t.includes('no le') || t.includes('unread')) return true;
          }

          const txt = (row.textContent || '').toLowerCase();
          if (txt.includes('no leídos') || txt.includes('no leidos') || txt.includes('unread')) return true;
          return false;
        } catch (_) {
          return false;
        }
      };

      const rows = Array.from(document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]'));
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        if (!matchesUnread(row)) continue;

        const dataEl = row.matches('[data-id]') ? row : row.querySelector('[data-id]');
        const dataId = dataEl?.getAttribute('data-id') ? String(dataEl.getAttribute('data-id')) : '';

        let phoneHint = '';
        try {
          const phoneSpan = row.querySelector('span[title]');
          const t = phoneSpan ? String(phoneSpan.getAttribute('title') || '') : '';
          if (t) phoneHint = t;
        } catch (_) {}

        if (!phoneHint) {
          try {
            phoneHint = (row.textContent || '').trim();
          } catch (_) {}
        }

        if (!dataId && !phoneHint) continue;

        try {
          row.scrollIntoView({ block: 'center' });
          row.click();
        } catch (_) {}

        const key = dataId || phoneHint || String(idx);
        return { dataId, phoneHint, key };
      }

      return null;
    });

    if (!candidate?.key) return null;
    return candidate;
  } catch (_) {
    return null;
  }
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
    } catch (_) {}

    // Asegurar que el filtro No leídos está activo (sin reventar CPU)
    try {
      await monitorPage.evaluate(() => {
        if (window.__anaClickUnreadOnce) window.__anaClickUnreadOnce();
      });
    } catch (_) {}

    const campaignName = await getCampaignNameForInteractions();
    
    // Diagnóstico: contar cuántos rows hay y cuántos tienen badge de no leído
    const diag = await monitorPage.evaluate(() => {
      try {
        const rows = document.querySelectorAll('[role="row"]');
        let withBadge = 0;
        let withAriaLabel = 0;
        
        rows.forEach(row => {
          const badge = row.querySelector('span[aria-label][role], span[aria-label]');
          if (badge) {
            const t = String(badge.getAttribute('aria-label') || '').toLowerCase();
            if (t.includes('no leído') || t.includes('no leido') || t.includes('unread') || t.includes('mensaje')) {
              withBadge++;
            }
          }
          
          const a = row.querySelector('[aria-label*="mensajes no leídos"], [aria-label*="unread"], [aria-label*="No leídos"]');
          if (a) withAriaLabel++;
        });
        
        return { totalRows: rows.length, withBadge, withAriaLabel };
      } catch (e) {
        return { error: e.message };
      }
    });
    
    console.log('👀 [Monitor] Diagnóstico chats:', diag);
    
    const candidate = await pickFirstUnreadChatCandidate();

    if (!candidate?.key) {
      console.log('👀 [Monitor] Sin chats no leídos detectables en este momento.');
      return;
    }
    
    console.log('✅ [Monitor] Chat no leído detectado:', { dataId: candidate.dataId, phoneHint: candidate.phoneHint, key: candidate.key });

    if (candidate.key === lastFirstChatDataId) {
      console.log('⏭️  [Monitor] Chat ya procesado en este ciclo (lastFirstChatDataId)');
      return;
    }
    lastFirstChatDataId = candidate.key;

    const phoneRaw = candidate.dataId ? parsePhoneFromDataId(candidate.dataId) : String(candidate.phoneHint || '');
    console.log('📞 [Monitor] phoneRaw extraído:', phoneRaw);
    
    const phoneE164 = normalizePhoneForBackend(phoneRaw);
    console.log('📞 [Monitor] phoneE164 normalizado:', phoneE164);
    
    const phoneDigits = String(phoneE164 || '').replace(/\D/g, '');
    const phone10 = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
    console.log('📞 [Monitor] phone10:', phone10);
    
    if (!phone10) {
      console.log('⚠️  [Monitor] No se pudo extraer teléfono válido');
      return;
    }

    if (processedPhones.has(phone10)) {
      console.log('⏭️  [Monitor] Teléfono ya procesado anteriormente:', phone10);
      return;
    }
    
    console.log('🔍 [Monitor] Consultando gestión para:', phone10);

    let gestionData = null;
    try {
      const gestionPromise = getGestionDataFromBackendForMonitor(campaignName, phoneDigits);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout 10s consultando gestión')), 10000)
      );
      gestionData = await Promise.race([gestionPromise, timeoutPromise]);
    } catch (e) {
      console.log('⚠️  [Monitor] Error/timeout consultando gestión:', e.message);
      return;
    }
    
    console.log('📊 [Monitor] Respuesta gestión:', { 
      hasData: !!gestionData, 
      clientInfoLength: Array.isArray(gestionData?.clientInfo) ? gestionData.clientInfo.length : 0,
      resultCodesLength: Array.isArray(gestionData?.resultCodes) ? gestionData.resultCodes.length : 0
    });
    console.log('📊 [Monitor] Respuesta gestión:', gestionData) ;
  
    
    const clientInfo = Array.isArray(gestionData?.clientInfo) ? gestionData.clientInfo : [];
    
    if (clientInfo.length === 0) {
      console.log('⚠️  [Monitor] Backend no devolvió clientInfo. Datos de consulta:', {
        campaignName,
        phoneDigits,
        phoneE164: gestionData?.phoneE164
      });
    } else {
      console.log('✅ [Monitor] clientInfo recibido:', clientInfo.length, 'registros');
    }
    
    const first = clientInfo[0] || null;
    const creditId = first?.credit_info?.credit_id || '';
    
    console.log('💳 [Monitor] creditId extraído:', creditId || '(vacío)');

    if (!creditId) {
      processedPhones.add(phone10);
      console.log(`⚠️  [Monitor] Sin crédito para teléfono ${phoneE164}. Marcado como procesado para no duplicar.`);
      return;
    }
    
    console.log('✅ [Monitor] creditId válido, preparando interacción...');

    const INTERACTIONS_USER_ID = '6898b89b-ab72-4196-92b1-70d51781f68f';
    const now = new Date();
    const contact_date = now.toISOString().slice(0, 10);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nextH = String((now.getHours() + 1) % 24).padStart(2, '0');

    const subdictamen = 'CLIENTE NO DEFINE';

    console.log('📤 [Monitor] Enviando interacción al backend...', {
      creditId,
      phone10,
      campaignName,
      subdictamen
    });

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

    console.log('📥 [Monitor] Respuesta insertInteractions:', { 
      ok: interactionRes?.ok, 
      status: interactionRes?.status,
      hasBody: !!interactionRes?.body 
    });

    if (interactionRes?.ok) {
      processedPhones.add(phone10);
      console.log(`✅ [Monitor] Interacción enviada (${phoneE164}) subdictamen='${subdictamen}' credit_id='${creditId}'`);
      try {
        await monitorPage.evaluate((p, c) => {
          if (window.__anaMonitorToast) window.__anaMonitorToast(`✅ Interacción enviada: ${p} (credit_id ${c})`);
        }, phoneE164, creditId);
      } catch (_) {}
    } else {
      console.error(`❌ [Monitor] Interacción NO enviada (${phoneE164}) subdictamen='${subdictamen}' credit_id='${creditId}'`);
      try {
        await monitorPage.evaluate((p) => {
          if (window.__anaMonitorToast) window.__anaMonitorToast(`❌ Interacción NO enviada: ${p}`);
        }, phoneE164);
      } catch (_) {}
    }

    if (interactionRes?.status) console.error(`   Status: ${interactionRes.status}`);
    if (interactionRes?.body) console.error(`   Body: ${JSON.stringify(interactionRes.body)}`);
    if (interactionRes?.error) console.error(`   Error: ${interactionRes.error}`);
  } finally {
    monitorBusy = false;
  }
}

/**
 * ====== UI/LOCK + CLICK HELPERS (IMPORTANTES)
 * - Se instalan UNA sola vez (bandera global)
 * - NO usamos observers de attributes (solo childList)
 * - Interval más lento (cada 5s) y “one-shot” por tick
 */
async function installMonitorHelpersOnce() {
  if (!monitorPage || monitorPage.isClosed()) return;

  await monitorPage.evaluate(() => {
    if (window.__anaMonitorHelpersInstalled) return;
    window.__anaMonitorHelpersInstalled = true;

    // ===== Toast =====
    window.__anaMonitorToast = (message) => {
      try {
        const id = 'ana-monitor-toast';
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = id;
        el.style.cssText = [
          'position: fixed',
          'bottom: 18px',
          'right: 18px',
          'max-width: 520px',
          'background: rgba(0, 0, 0, 0.82)',
          'color: #fff',
          'padding: 12px 14px',
          'border-radius: 10px',
          'font-family: Arial, sans-serif',
          'font-size: 13px',
          'line-height: 1.35',
          'z-index: 2147483647',
          'box-shadow: 0 6px 22px rgba(0,0,0,0.35)',
          'border: 1px solid rgba(255,255,255,0.15)',
          'pointer-events: none',
          'opacity: 0',
          'transform: translateY(6px)',
          'transition: opacity 160ms ease, transform 160ms ease',
        ].join(';');

        el.textContent = String(message || '');
        (document.body || document.documentElement).appendChild(el);

        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0px)';
        }, 10);

        setTimeout(() => {
          el.style.opacity = '0';
          el.style.transform = 'translateY(6px)';
        }, 3500);

        setTimeout(() => {
          try {
            el.remove();
          } catch (_) {}
        }, 4200);
      } catch (_) {}
    };

    // ===== Lock overlay =====
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
          background: rgba(0, 0, 0, 0.20);
          z-index: 2147483646;
          pointer-events: auto !important;
          cursor: not-allowed;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        #monitor-login-overlay,
        #monitor-login-overlay * {
          pointer-events: auto !important;
          user-select: text !important;
          -webkit-user-select: text !important;
          z-index: 2147483647 !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    const ensureLockOverlay = () => {
      try {
        if (!window.__anaMonitorLocked) return;
        let ov = document.getElementById('ana-monitor-lock-overlay');
        if (ov) return;

        ov = document.createElement('div');
        ov.id = 'ana-monitor-lock-overlay';
        ov.style.position = 'fixed';
        ov.style.inset = '0';
        ov.style.background = 'rgba(0, 0, 0, 0.20)';
        ov.style.zIndex = '2147483646';
        ov.style.pointerEvents = 'auto';
        ov.style.cursor = 'not-allowed';
        ov.style.display = 'block';

        const stop = (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) {}
          return false;
        };

        ov.addEventListener('contextmenu', stop, true);
        ov.addEventListener('mousedown', stop, true);
        ov.addEventListener('mouseup', stop, true);
        ov.addEventListener('click', stop, true);
        ov.addEventListener('pointerdown', stop, true);
        ov.addEventListener('pointerup', stop, true);

        (document.body || document.documentElement).appendChild(ov);
      } catch (_) {}
    };

    window.__anaEnableMonitorLock = () => {
      try {
        document.body.classList.add('ana-monitor-hardlock');
        window.__anaMonitorLocked = true;
        ensureLockOverlay();

        if (!window.__anaMonitorLockWatchdog) {
          window.__anaMonitorLockWatchdog = setInterval(() => {
            try {
              ensureLockOverlay();
            } catch (_) {}
          }, 1200);
        }
      } catch (_) {}
    };

    window.__anaDisableMonitorLock = () => {
      try {
        document.body.classList.remove('ana-monitor-hardlock');
        const ov = document.getElementById('ana-monitor-lock-overlay');
        if (ov) ov.remove();
        if (window.__anaMonitorLockWatchdog) {
          clearInterval(window.__anaMonitorLockWatchdog);
          window.__anaMonitorLockWatchdog = null;
        }
        window.__anaMonitorLocked = false;
      } catch (_) {}
    };

    // ===== Click Unread (robusto) =====
    const getUnreadBtn = () => {
      try {
        return document.querySelector('#unread-filter');
      } catch (_) {
        return null;
      }
    };

    window.__anaClickUnreadOnce = () => {
      try {
        if (document.getElementById('monitor-login-overlay')) return false;
        const btn = getUnreadBtn();
        if (!btn) return false;

        const pressed = String(btn.getAttribute('aria-pressed') || '').toLowerCase();
        if (pressed === 'true') return true;

        try {
          btn.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        const fire = (type) => {
          try {
            btn.dispatchEvent(
              new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse' })
            );
          } catch (_) {}
          try {
            btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
          } catch (_) {}
        };

        fire('pointerdown');
        fire('mousedown');
        fire('mouseup');
        fire('pointerup');
        fire('click');

        try {
          btn.click();
        } catch (_) {}

        const after = String(btn.getAttribute('aria-pressed') || '').toLowerCase();
        return after === 'true';
      } catch (_) {
        return false;
      }
    };

    // Watchdog LIGHT: solo si ya hay sidebar y existe el botón (cada 5s)
    if (!window.__anaUnreadLightInterval) {
      window.__anaUnreadLightInterval = setInterval(() => {
        try {
          const side = document.querySelector('#side, #pane-side');
          if (!side) return;
          const btn = getUnreadBtn();
          if (!btn) return;
          window.__anaClickUnreadOnce();
        } catch (_) {}
      }, 5000);
    }

    // Observer LIGHT: solo para cuando cambie el DOM (sin observar attributes)
    if (!window.__anaUnreadObserver) {
      window.__anaUnreadObserver = new MutationObserver(() => {
        try {
          const side = document.querySelector('#side, #pane-side');
          if (!side) return;
          const btn = getUnreadBtn();
          if (!btn) return;
          window.__anaClickUnreadOnce();
        } catch (_) {}
      });

      if (document.documentElement) {
        window.__anaUnreadObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
  });
}

/**
 * Bloquear DevTools shortcuts/contextmenu (una sola vez con initScript)
 */
async function installHardKeyBlockersOnce() {
  if (!monitorPage || monitorPage.isClosed()) return;

  await monitorPage.addInitScript(() => {
    if (window.__anaKeyBlockInstalled) return;
    window.__anaKeyBlockInstalled = true;

    document.addEventListener(
      'keydown',
      (e) => {
        const k = e.key;
        const bad =
          k === 'F12' ||
          (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(k)) ||
          (e.metaKey && e.altKey && ['I', 'J', 'C'].includes(k));

        if (bad) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      },
      true
    );

    document.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      },
      true
    );
  });
}

async function clickUnreadFilterRobust() {
  // Espera a que exista la zona de filtros y el botón real (por tu HTML)
  await monitorPage.waitForSelector('[aria-label="chat-list-filters"]', { timeout: 60000 });
  await monitorPage.waitForSelector('#unread-filter', { timeout: 60000 });

  // Evita que el lock overlay intercepte (por si se prendió por timing)
  await monitorPage.evaluate(() => {
    if (window.__anaDisableMonitorLock) window.__anaDisableMonitorLock();
  });

  const result = await monitorPage.evaluate(() => {
    const btn = document.querySelector('#unread-filter');
    if (!btn) return { found: false };

    const before = String(btn.getAttribute('aria-pressed') || '');
    if (before.toLowerCase() === 'true') return { found: true, clicked: false, before, after: before };

    try {
      btn.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (_) {}

    const fire = (type) => {
      try {
        btn.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse' }));
      } catch (_) {}
      try {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
      } catch (_) {}
    };

    fire('pointerdown');
    fire('mousedown');
    fire('mouseup');
    fire('pointerup');
    fire('click');

    try {
      btn.click();
    } catch (_) {}

    const after = String(btn.getAttribute('aria-pressed') || '');
    return { found: true, clicked: true, before, after };
  });

  return result;
}

export async function initMonitorWhatsApp() {
  console.log(' Iniciando ventana monitor de WhatsApp (No leídos)...');

  const monitorNoLock = process.argv.includes('--monitor-no-lock');
  const monitorClearData = process.argv.includes('--monitor-clear-data');
  const monitorAltProfile = process.argv.includes('--monitor-alt-profile');
  const monitorNonPersistent = process.argv.includes('--monitor-non-persistent');
  const monitorProfilePath = monitorAltProfile ? `${CONFIG.monitorSessionPath}-alt` : CONFIG.monitorSessionPath;

  const buildMonitorArgs = () => {
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
      '--app=https://web.whatsapp.com',
      '--disable-dev-tools',
    ];
  };

  const relaunchMonitorBrowser = async (reason) => {
    try {
      const profileLabel = monitorNonPersistent ? 'TEMP' : monitorAltProfile ? 'ALT' : 'DEFAULT';
      console.log(`🔁 [Monitor] Iniciando navegador (${reason || 'recover'}) profile=${profileLabel}...`);
    } catch (_) {}

    try {
      if (monitorBrowser) await monitorBrowser.close();
    } catch (_) {}

    try {
      if (monitorContext && !monitorBrowser) await monitorContext.close();
    } catch (_) {}

    try {
      if (monitorPwBrowser) await monitorPwBrowser.close();
    } catch (_) {}

    monitorBrowser = null;
    monitorPwBrowser = null;
    monitorContext = null;
    monitorPage = null;

    if (!monitorNonPersistent) {
      monitorBrowser = await chromium.launchPersistentContext(monitorProfilePath, {
        headless: false,
        args: buildMonitorArgs(),
        viewport: { width: 1280, height: 720 },
        devtools: false,
      });
      monitorContext = monitorBrowser;
      monitorPage = monitorContext.pages()[0] || (await monitorContext.newPage());
      return;
    }

    monitorPwBrowser = await chromium.launch({
      headless: false,
      args: buildMonitorArgs(),
      devtools: false,
    });
    monitorContext = await monitorPwBrowser.newContext({ viewport: { width: 1280, height: 720 } });
    monitorPage = await monitorContext.newPage();
  };

  await relaunchMonitorBrowser('init');

  const clearMonitorBrowserData = async () => {
    if (!monitorClearData) return;

    console.log('🧹 [Monitor] Limpiando cookies/cache/storage (modo --monitor-clear-data)...');

    try {
      const cdp = await monitorContext.newCDPSession(monitorPage);
      try {
        await cdp.send('Network.clearBrowserCache');
      } catch (_) {}
      try {
        await cdp.send('Network.clearBrowserCookies');
      } catch (_) {}
    } catch (_) {}

    try {
      await monitorContext.clearCookies();
    } catch (_) {}

    try {
      await monitorPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {}

    try {
      await monitorPage.evaluate(async () => {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}

        try {
          if (typeof caches !== 'undefined' && caches?.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch (_) {}

        try {
          if (typeof indexedDB !== 'undefined' && indexedDB?.databases) {
            const dbs = await indexedDB.databases();
            await Promise.all(
              (dbs || []).map(
                (db) =>
                  new Promise((resolve) => {
                    try {
                      if (!db?.name) return resolve();
                      const req = indexedDB.deleteDatabase(db.name);
                      req.onsuccess = () => resolve();
                      req.onerror = () => resolve();
                      req.onblocked = () => resolve();
                    } catch (_) {
                      resolve();
                    }
                  })
              )
            );
          }
        } catch (_) {}
      });
    } catch (_) {}

    console.log('🧹 [Monitor] Limpieza completa.');
  };

  if (!monitorContext) throw new Error('Monitor: contexto no inicializado');

  if (!monitorPage) {
    const pages = monitorContext.pages();
    monitorPage = pages[0] || (await monitorContext.newPage());
  }

  await installHardKeyBlockersOnce();
  await clearMonitorBrowserData();

  // IMPORTANTE: evita networkidle; WhatsApp nunca “idle” de manera confiable
  await monitorPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

  console.log('⏳ Esperando que WhatsApp Web (Monitor) cargue completamente...');
  try {
    await monitorPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await monitorPage.waitForTimeout(1200);
  } catch (_) {}

  // Detectar si ya hay sesión iniciada (sidebar presente)
  const hasExistingSession = await monitorPage.evaluate(() => {
    try {
      return Boolean(document.querySelector('#side, #pane-side'));
    } catch (_) {
      return false;
    }
  });

  // Instalar helpers una sola vez (toast + lock + click unread light)
  await installMonitorHelpersOnce();

  if (hasExistingSession) {
    console.log('🔒 [Monitor] Sesión existente detectada.');
    if (!monitorNoLock) {
      await monitorPage.evaluate(() => {
        window.__anaMonitorLocked = true;
        if (window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
      });
      console.log('🔒 [Monitor] Overlay activado (sesión ya iniciada).');
    }
  }

  console.log('🔐 Validación de credenciales requerida (Monitor)...');
  console.log('📝 Ingresa usuario, campaña y palabra del día');

  const monitorConfig = await showMonitorLoginOverlay(true);
  saveAgentConfig(monitorConfig);
  console.log(`✅ Credenciales verificadas (Monitor): ${monitorConfig.agent_id} | Campaña: ${monitorConfig.campaign}`);

  if (!hasExistingSession) {
    console.log('📱 Escanea el código QR con OTRO teléfono/cuenta');
  }
  console.log('⏳ Esperando conexión de WhatsApp Web (Monitor)...');

  // Esperar conexión (sidebar)
  await monitorPage.waitForSelector('#side, #pane-side', { timeout: 300000 });
  console.log('✅ WhatsApp Web (Monitor) conectado - Ventana lista!');

  // Re-instalar helpers por si WhatsApp recargó duro (idempotente)
  await installMonitorHelpersOnce();

  // Click robusto al filtro real: #unread-filter
  console.log('🔍 [Monitor] Activando filtro "No leídos"...');
  let clickedRes = null;
  try {
    clickedRes = await Promise.race([
      clickUnreadFilterRobust(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 25s activando unread')), 25000)),
    ]);
  } catch (e) {
    console.log('⚠️  [Monitor] No se pudo activar "No leídos" a tiempo:', e.message);
  }

  console.log('👀 [Monitor] Resultado click unread:', clickedRes);

  // Activar lock después del click (no antes)
  if (!monitorNoLock) {
    try {
      await monitorPage.evaluate(() => {
        window.__anaMonitorLocked = true;
        if (window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
      });
      console.log('🔒 [Monitor] Overlay activado - Ventana bloqueada');
    } catch (e) {
      console.log('⚠️  [Monitor] Error activando overlay:', e.message);
    }
  }

  // Re-aplicar lock en cada load (sin reinstalar intervals/observers)
  monitorPage.on('load', async () => {
    try {
      await installMonitorHelpersOnce();
      await monitorPage.evaluate(() => {
        if (window.__anaMonitorLocked && window.__anaEnableMonitorLock) window.__anaEnableMonitorLock();
      });
    } catch (_) {}
  });

  // Loop de monitoreo
  processedPhones = new Set();
  if (monitorLoopInterval) {
    try {
      clearInterval(monitorLoopInterval);
    } catch (_) {}
  }

  monitorLoopInterval = setInterval(() => {
    try {
      const ts = new Date();
      const hh = String(ts.getHours()).padStart(2, '0');
      const mm = String(ts.getMinutes()).padStart(2, '0');
      const ss = String(ts.getSeconds()).padStart(2, '0');
      console.log(`👀 [Monitor] Poll tick ${hh}:${mm}:${ss}`);
    } catch (_) {}
    monitorUnreadLoop().catch(() => null);
  }, 5000);

  console.log('✅ [Monitor] Loop iniciado.');
}

export async function closeMonitorBrowser() {
  if (!monitorBrowser && !monitorContext && !monitorPwBrowser) return;
  console.log('🔒 Cerrando navegador monitor...');

  if (monitorLoopInterval) {
    try {
      clearInterval(monitorLoopInterval);
    } catch (_) {}
    monitorLoopInterval = null;
  }

  try {
    if (monitorBrowser) await monitorBrowser.close();
  } catch (_) {}

  try {
    if (!monitorBrowser && monitorContext) await monitorContext.close();
  } catch (_) {}

  try {
    if (monitorPwBrowser) await monitorPwBrowser.close();
  } catch (_) {}

  monitorBrowser = null;
  monitorPwBrowser = null;
  monitorContext = null;
  monitorPage = null;
}

export function getMonitorPage() {
  return monitorPage;
}
