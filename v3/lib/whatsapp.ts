import { chromium, BrowserContext, Page } from 'playwright'
import path from 'path'
import { replaceTemplateVariables } from './template'

const WHATSAPP_URL = 'https://web.whatsapp.com'
const SESSION_PATH = path.join(process.cwd(), 'whatsapp-session')

// Usar globalThis para persistir entre hot reloads en desarrollo
declare global {
  var whatsappBrowser: BrowserContext | null
  var whatsappPage: Page | null
}

// Inicializar si no existen
if (!global.whatsappBrowser) {
  global.whatsappBrowser = null
}
if (!global.whatsappPage) {
  global.whatsappPage = null
}

// Referencias locales que apuntan a las globales
let browser: BrowserContext | null = global.whatsappBrowser
let page: Page | null = global.whatsappPage

// Función para sincronizar las referencias
function syncGlobals() {
  global.whatsappBrowser = browser
  global.whatsappPage = page
}

// Función para obtener las referencias actuales
function getGlobals() {
  browser = global.whatsappBrowser
  page = global.whatsappPage
}

export async function initWhatsApp() {
  try {
    // Obtener referencias actuales de las globales
    getGlobals()
    
    if (browser && page) {
      console.log('✅ Ya existe una sesión activa (desde global)')
      const isConnected = await checkConnection()
      return { 
        success: true, 
        message: isConnected ? 'Ya conectado' : 'Sesión activa - escanea QR si es necesario' 
      }
    }

    console.log('🚀 Iniciando nuevo browser...')
    
    browser = await chromium.launchPersistentContext(SESSION_PATH, {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
      viewport: { width: 1280, height: 720 },
    })

    console.log('✅ Browser creado')

    // Listener para detectar si se cierra
    browser.on('close', () => {
      console.log('⚠️⚠️⚠️ BROWSER CERRADO - limpiando referencias')
      browser = null
      page = null
      global.whatsappBrowser = null
      global.whatsappPage = null
    })

    console.log('📊 Estado actual: browser =', browser !== null, ', page =', page !== null)

    page = browser.pages()[0] || await browser.newPage()
    console.log('✅ Page obtenida')
    
    // Sincronizar con globales
    syncGlobals()

    await page.goto(WHATSAPP_URL, { waitUntil: 'networkidle' })
    console.log('✅ Navegado a WhatsApp Web')

    // Esperar a que se cargue WhatsApp Web
    await page.waitForTimeout(5000)
    console.log('⏳ Esperando carga completa...')

    // Verificar si está conectado
    const isConnected = await checkConnection()

    if (isConnected) {
      console.log('🎉 WhatsApp conectado exitosamente')
      console.log('📊 Al finalizar initWhatsApp: browser =', browser !== null, ', page =', page !== null)
      console.log('📊 Globales: whatsappBrowser =', global.whatsappBrowser !== null, ', whatsappPage =', global.whatsappPage !== null)
      return { success: true, message: 'Conectado a WhatsApp Web' }
    } else {
      console.log('📱 Esperando escaneo de QR')
      console.log('📊 Al finalizar initWhatsApp: browser =', browser !== null, ', page =', page !== null)
      console.log('📊 Globales: whatsappBrowser =', global.whatsappBrowser !== null, ', whatsappPage =', global.whatsappPage !== null)
      return { success: true, message: 'Escanea el código QR para conectar' }
    }
  } catch (error) {
    console.error('❌ Error al inicializar WhatsApp:', error)
    browser = null
    page = null
    global.whatsappBrowser = null
    global.whatsappPage = null
    return { success: false, message: 'Error al inicializar WhatsApp' }
  }
}

export async function checkConnection(): Promise<boolean> {
  try {
    // Obtener referencias actuales
    getGlobals()
    
    console.log('🔎 checkConnection llamado - browser:', browser !== null, ', page:', page !== null)
    console.log('🔎 Globales: whatsappBrowser:', global.whatsappBrowser !== null, ', whatsappPage:', global.whatsappPage !== null)
    
    if (!browser || !page) {
      console.log('❌ Browser o page es null')
      return false
    }

    // Verificar si la página está activa
    const url = page.url()
    console.log('📍 URL actual:', url)
    
    if (!url.includes('web.whatsapp.com')) {
      console.log('❌ No está en WhatsApp Web')
      return false
    }

    // Intentar múltiples selectores para verificar conexión
    const selectors = [
      '[data-testid="chat-list"]',
      '#side',
      '[data-testid="conversation-compose-box-input"]',
      'div[role="textbox"]',
      '#pane-side'
    ]

    console.log('🔍 Buscando elementos de WhatsApp...')
    
    for (const selector of selectors) {
      const element = await page.$(selector)
      if (element) {
        console.log(`✅ WhatsApp conectado (encontrado: ${selector})`)
        return true
      }
    }

    // Si no encontramos ningún selector, verificar si hay QR code
    const qrCode = await page.$('canvas[aria-label="Scan this QR code to link a device!"]')
    if (qrCode) {
      console.log('📱 Código QR visible - necesitas escanear')
      return false
    }

    console.log('❌ WhatsApp no conectado (no se encontraron elementos conocidos)')
    return false
  } catch (error) {
    console.error('❌ Error al verificar conexión:', error)
    return false
  }
}

export async function sendMessage(phone: string, message: string): Promise<boolean> {
  try {
    // Obtener referencias actuales
    getGlobals()
    
    if (!browser || !page) {
      console.error('WhatsApp no está inicializado. Por favor, conecta WhatsApp primero.')
      return false
    }

    // Formatear el número de teléfono (eliminar caracteres no numéricos)
    const cleanPhone = phone.replace(/\D/g, '')

    // Abrir chat usando la URL directa
    const chatUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`
    await page.goto(chatUrl, { waitUntil: 'networkidle', timeout: 30000 })

    // Esperar a que cargue el chat
    await page.waitForTimeout(3000)

    // Verificar si el número es válido
    const invalidNumber = await page.$('text=El número de teléfono compartido a través de la dirección URL no es válido')
    if (invalidNumber) {
      console.error(`Número inválido: ${phone}`)
      return false
    }

    // Buscar el campo de texto del mensaje
    const messageBox = await page.waitForSelector('[data-testid="conversation-compose-box-input"]', {
      timeout: 10000,
    })

    if (!messageBox) {
      throw new Error('No se encontró el campo de mensaje')
    }

    // Escribir el mensaje
    await messageBox.click()
    await page.keyboard.type(message, { delay: 100 })

    // Esperar un momento antes de enviar
    await page.waitForTimeout(1000)

    // Enviar el mensaje
    const sendButton = await page.waitForSelector('[data-testid="send"]', {
      timeout: 5000,
    })

    if (sendButton) {
      await sendButton.click()
      await page.waitForTimeout(2000)
      return true
    }

    return false
  } catch (error) {
    console.error(`Error al enviar mensaje a ${phone}:`, error)
    return false
  }
}

export async function sendBulkMessages(
  contacts: Array<{
    phone: string
    name: string
    credit?: string
    discount?: string
    first_name?: string
    last_name?: string
    total_balanc?: string
    product?: string
    [key: string]: string | undefined
  }>,
  messageTemplate: string,
  delay: number = 5
): Promise<{ success: boolean; sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  for (const contact of contacts) {
    try {
      // Replace template variables with contact data
      const personalizedMessage = replaceTemplateVariables(messageTemplate, contact)
      
      const success = await sendMessage(contact.phone, personalizedMessage)
      if (success) {
        sent++
        console.log(`✓ Mensaje enviado a ${contact.name} (${contact.phone})`)
      } else {
        failed++
        console.error(`✗ Error al enviar mensaje a ${contact.name} (${contact.phone})`)
      }

      // Esperar el delay configurado entre mensajes
      if (contacts.indexOf(contact) < contacts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * 1000))
      }
    } catch (error) {
      failed++
      console.error(`✗ Error al enviar mensaje a ${contact.name}:`, error)
    }
  }

  return { success: true, sent, failed }
}

export async function closeWhatsApp() {
  try {
    if (browser) {
      await browser.close()
      browser = null
      page = null
    }
  } catch (error) {
    console.error('Error al cerrar WhatsApp:', error)
  }
}

export function getStatus() {
  return {
    isInitialized: browser !== null,
    isConnected: page !== null,
    hasPage: page !== null,
    hasBrowser: browser !== null,
  }
}

export function getBrowserInfo() {
  return {
    browser: browser !== null ? 'active' : 'null',
    page: page !== null ? 'active' : 'null',
    sessionPath: SESSION_PATH,
  }
}

export async function diagnoseConnection() {
  // Obtener referencias actuales
  getGlobals()
  
  const info: any = {
    browser: browser !== null,
    page: page !== null,
    globalBrowser: global.whatsappBrowser !== null,
    globalPage: global.whatsappPage !== null,
    url: null,
    elements: {},
    qrCode: false,
    browserClosed: false,
  }

  // Verificar si el browser está cerrado
  if (browser) {
    try {
      const pages = browser.pages()
      info.browserClosed = pages.length === 0
      info.pagesCount = pages.length
    } catch (error) {
      info.browserClosed = true
      info.browserError = String(error)
    }
  }

  if (page) {
    try {
      info.url = page.url()
      
      // Verificar cada selector
      const selectors = [
        '[data-testid="chat-list"]',
        '#side',
        '[data-testid="conversation-compose-box-input"]',
        'div[role="textbox"]',
        '#pane-side',
        'canvas' // Para detectar QR
      ]

      for (const selector of selectors) {
        const element = await page.$(selector)
        info.elements[selector] = element !== null
      }

      // Verificar QR con múltiples selectores
      const qrSelectors = [
        'canvas[aria-label="Scan this QR code to link a device!"]',
        'canvas[aria-label*="QR"]',
        'canvas'
      ]
      
      for (const qrSelector of qrSelectors) {
        const qrCode = await page.$(qrSelector)
        if (qrCode) {
          info.qrCode = true
          info.qrSelector = qrSelector
          break
        }
      }
    } catch (error) {
      info.error = String(error)
    }
  }

  console.log('🔍 DIAGNÓSTICO COMPLETO:', JSON.stringify(info, null, 2))
  return info
}
