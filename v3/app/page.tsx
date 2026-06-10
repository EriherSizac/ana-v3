'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Users, Send, CheckCircle, AlertCircle, Loader2, Info } from 'lucide-react'

interface Contact {
  id: string
  phone: string
  name: string
  credit?: string
  discount?: string
  first_name?: string
  last_name?: string
  total_balanc?: string
  product?: string
}

interface Campaign {
  id: string
  message: string
  contacts: Contact[]
  status: 'pending' | 'running' | 'completed' | 'error'
  sent: number
  total: number
}

export default function Home() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [message, setMessage] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [sessionStatus, setSessionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [delay, setDelay] = useState(5)
  const [showTemplateHelp, setShowTemplateHelp] = useState(false)

  useEffect(() => {
    checkSessionStatus()
  }, [])

  const checkSessionStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status')
      const data = await res.json()
      setSessionStatus(data.status)
    } catch (error) {
      setSessionStatus('disconnected')
    }
  }

  const connectWhatsApp = async () => {
    setSessionStatus('connecting')
    try {
      const res = await fetch('/api/whatsapp/connect', { method: 'POST' })
      const data = await res.json()
      console.log('Respuesta de conexión:', data)
      
      if (data.success) {
        // Esperar un momento y verificar el estado real
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        const statusCheck = await fetch('/api/whatsapp/status')
        const statusData = await statusCheck.json()
        console.log('Estado después de conectar:', statusData)
        
        if (statusData.status === 'connected') {
          setSessionStatus('connected')
          alert('WhatsApp conectado exitosamente. Ahora puedes enviar mensajes.')
        } else {
          setSessionStatus('disconnected')
          alert('WhatsApp se abrió pero aún no está conectado. Por favor, escanea el código QR y espera a que cargue.')
        }
      } else {
        setSessionStatus('disconnected')
        alert(`Error al conectar con WhatsApp: ${data.message || 'Error desconocido'}`)
      }
    } catch (error) {
      setSessionStatus('disconnected')
      alert('Error al conectar con WhatsApp')
      console.error('Error:', error)
    }
  }

  const runDiagnostic = async () => {
    try {
      const res = await fetch('/api/whatsapp/diagnose')
      const data = await res.json()
      console.log('🔍 DIAGNÓSTICO:', data)
      
      if (data.success) {
        const diag = data.diagnosis
        let message = '🔍 DIAGNÓSTICO DE CONEXIÓN:\n\n'
        message += `Browser: ${diag.browser ? '✅' : '❌'}\n`
        message += `Page: ${diag.page ? '✅' : '❌'}\n`
        
        if (diag.browserClosed) {
          message += `⚠️ Browser cerrado o sin páginas\n`
        }
        
        if (diag.pagesCount !== undefined) {
          message += `Páginas abiertas: ${diag.pagesCount}\n`
        }
        
        message += `URL: ${diag.url || 'N/A'}\n`
        message += `QR Code visible: ${diag.qrCode ? '📱 Sí' : '❌ No'}\n`
        
        if (diag.qrSelector) {
          message += `QR encontrado en: ${diag.qrSelector}\n`
        }
        
        message += '\nElementos encontrados:\n'
        
        let foundCount = 0
        for (const [selector, found] of Object.entries(diag.elements)) {
          if (found) foundCount++
          message += `${found ? '✅' : '❌'} ${selector}\n`
        }
        
        message += `\n📊 Total elementos: ${foundCount}/${Object.keys(diag.elements).length}\n`
        
        if (diag.error) {
          message += `\n❌ Error: ${diag.error}\n`
        }
        
        // Recomendación
        message += '\n💡 RECOMENDACIÓN:\n'
        if (!diag.browser || !diag.page) {
          message += '→ Haz clic en "Conectar WhatsApp"\n'
        } else if (diag.browserClosed) {
          message += '→ El browser se cerró. Reconecta WhatsApp\n'
        } else if (diag.qrCode) {
          message += '→ Escanea el código QR con tu teléfono\n'
        } else if (foundCount === 0) {
          message += '→ WhatsApp está cargando. Espera 10 seg y verifica de nuevo\n'
        } else if (foundCount > 0) {
          message += '→ ✅ WhatsApp parece estar conectado!\n'
        }
        
        alert(message)
      }
    } catch (error) {
      console.error('Error en diagnóstico:', error)
      alert('Error al ejecutar diagnóstico')
    }
  }

  const addContact = () => {
    if (phoneInput && nameInput) {
      const newContact: Contact = {
        id: Date.now().toString(),
        phone: phoneInput,
        name: nameInput,
      }
      setContacts([...contacts, newContact])
      setPhoneInput('')
      setNameInput('')
    }
  }

  const removeContact = (id: string) => {
    setContacts(contacts.filter(c => c.id !== id))
  }

  const importContacts = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        const lines = text.split('\n')
        
        if (lines.length < 2) {
          alert('El archivo CSV está vacío o no tiene el formato correcto')
          return
        }

        // Parse header to get column names
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
        
        const newContacts: Contact[] = lines
          .slice(1)
          .filter(line => line.trim())
          .map((line, index) => {
            const values = line.split(',').map(s => s.trim())
            const contact: Contact = {
              id: `${Date.now()}-${index}`,
              phone: '',
              name: '',
            }

            // Map CSV columns to contact fields
            headers.forEach((header, idx) => {
              const value = values[idx] || ''
              switch (header) {
                case 'contact_pho':
                case 'phone':
                case 'telefono':
                  contact.phone = value
                  break
                case 'name':
                case 'nombre':
                  contact.name = value
                  break
                case 'credit':
                case 'credito':
                  contact.credit = value
                  break
                case 'discount':
                case 'descuento':
                  contact.discount = value
                  break
                case 'first_name':
                case 'nombre_pila':
                  contact.first_name = value
                  break
                case 'last_name':
                case 'apellido':
                  contact.last_name = value
                  break
                case 'total_balanc':
                case 'balance':
                case 'saldo':
                  contact.total_balanc = value
                  break
                case 'product':
                case 'producto':
                  contact.product = value
                  break
              }
            })

            // Set name from first_name + last_name if name is empty
            if (!contact.name && (contact.first_name || contact.last_name)) {
              contact.name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
            }

            // Set name to phone if still empty
            if (!contact.name) {
              contact.name = contact.phone
            }

            return contact
          })
          .filter(c => c.phone) // Only keep contacts with phone numbers

        if (newContacts.length === 0) {
          alert('No se encontraron contactos válidos en el CSV')
          return
        }

        setContacts([...contacts, ...newContacts])
        alert(`${newContacts.length} contactos importados correctamente`)
      }
      reader.readAsText(file)
    }
  }

  const sendCampaign = async () => {
    if (!message || contacts.length === 0) {
      alert('Por favor, agrega un mensaje y al menos un contacto')
      return
    }

    // Verificar estado real antes de enviar
    setSessionStatus('connecting')
    const statusCheck = await fetch('/api/whatsapp/status')
    const statusData = await statusCheck.json()
    
    console.log('Estado de conexión:', statusData)
    
    if (statusData.status !== 'connected') {
      setSessionStatus('disconnected')
      alert('WhatsApp no está conectado. Por favor, haz clic en "Conectar WhatsApp" primero.')
      return
    }
    
    setSessionStatus('connected')

    const campaign: Campaign = {
      id: Date.now().toString(),
      message,
      contacts,
      status: 'running',
      sent: 0,
      total: contacts.length,
    }

    setCampaigns([campaign, ...campaigns])

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, contacts, delay }),
      })

      const data = await res.json()

      if (data.success) {
        setCampaigns(prev =>
          prev.map(c =>
            c.id === campaign.id
              ? { ...c, status: 'completed', sent: c.total }
              : c
          )
        )
        setMessage('')
        setContacts([])
        alert(`Campaña completada: ${data.sent} enviados, ${data.failed} fallidos`)
      } else {
        setCampaigns(prev =>
          prev.map(c =>
            c.id === campaign.id ? { ...c, status: 'error' } : c
          )
        )
        alert(`Error: ${data.message || 'No se pudieron enviar los mensajes'}`)
        
        // Si WhatsApp no está conectado, actualizar el estado
        if (data.message?.includes('no está conectado')) {
          setSessionStatus('disconnected')
        }
      }
    } catch (error) {
      setCampaigns(prev =>
        prev.map(c =>
          c.id === campaign.id ? { ...c, status: 'error' } : c
        )
      )
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <MessageSquare className="w-12 h-12 text-whatsapp-primary" />
            <h1 className="text-4xl font-bold text-gray-800">WhatsApp Mass Sender</h1>
          </div>
          <p className="text-gray-600">Sistema automatizado de envío masivo de mensajes</p>
        </header>

        {/* Session Status */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${
                sessionStatus === 'connected' ? 'bg-green-500' :
                sessionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                'bg-red-500'
              }`} />
              <span className="font-semibold">
                Estado: {
                  sessionStatus === 'connected' ? 'Conectado' :
                  sessionStatus === 'connecting' ? 'Conectando...' :
                  'Desconectado'
                }
              </span>
              <button
                onClick={checkSessionStatus}
                className="text-sm text-blue-600 hover:text-blue-800 underline ml-2"
                title="Verificar estado de conexión"
              >
                Verificar
              </button>
              <button
                onClick={runDiagnostic}
                className="text-sm text-purple-600 hover:text-purple-800 underline ml-2"
                title="Diagnóstico completo"
              >
                🔍 Diagnóstico
              </button>
            </div>
            <div className="flex gap-2">
              {sessionStatus !== 'connected' && (
                <button
                  onClick={connectWhatsApp}
                  disabled={sessionStatus === 'connecting'}
                  className="bg-whatsapp-primary text-white px-6 py-2 rounded-lg hover:bg-whatsapp-dark transition-colors disabled:opacity-50"
                >
                  {sessionStatus === 'connecting' ? 'Conectando...' : 'Conectar WhatsApp'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Contacts Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-6 h-6 text-blue-600" />
              <h2 className="text-2xl font-bold text-gray-800">Contactos</h2>
            </div>

            <div className="space-y-4 mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Teléfono (ej: 521234567890)"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-whatsapp-primary focus:border-transparent"
                />
                <input
                  type="text"
                  placeholder="Nombre"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-whatsapp-primary focus:border-transparent"
                />
                <button
                  onClick={addContact}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Agregar
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors text-center">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={importContacts}
                    className="hidden"
                  />
                  Importar CSV con datos
                </label>
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-800">{contact.name}</p>
                    <p className="text-sm text-gray-600">{contact.phone}</p>
                    {(contact.credit || contact.discount || contact.product || contact.total_balanc) && (
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                        {contact.first_name && (
                          <span className="text-gray-500">
                            <strong>Nombre:</strong> {contact.first_name}
                          </span>
                        )}
                        {contact.last_name && (
                          <span className="text-gray-500">
                            <strong>Apellido:</strong> {contact.last_name}
                          </span>
                        )}
                        {contact.credit && (
                          <span className="text-gray-500">
                            <strong>Crédito:</strong> {contact.credit}
                          </span>
                        )}
                        {contact.discount && (
                          <span className="text-gray-500">
                            <strong>Descuento:</strong> {contact.discount}
                          </span>
                        )}
                        {contact.total_balanc && (
                          <span className="text-gray-500">
                            <strong>Balance:</strong> {contact.total_balanc}
                          </span>
                        )}
                        {contact.product && (
                          <span className="text-gray-500">
                            <strong>Producto:</strong> {contact.product}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeContact(contact.id)}
                    className="text-red-600 hover:text-red-800 ml-2"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {contacts.length === 0 && (
                <p className="text-center text-gray-500 py-8">No hay contactos agregados</p>
              )}
            </div>
          </div>

          {/* Message Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send className="w-6 h-6 text-green-600" />
                <h2 className="text-2xl font-bold text-gray-800">Mensaje con Plantilla</h2>
              </div>
              <button
                onClick={() => setShowTemplateHelp(!showTemplateHelp)}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                <Info className="w-4 h-4" />
                {showTemplateHelp ? 'Ocultar' : 'Ver'} variables
              </button>
            </div>

            {showTemplateHelp && (
              <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">Variables disponibles:</h3>
                <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
                  <code className="bg-white px-2 py-1 rounded">{'{{first_name}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{last_name}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{name}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{phone}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{credit}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{discount}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{total_balanc}}'}</code>
                  <code className="bg-white px-2 py-1 rounded">{'{{product}}'}</code>
                </div>
                <p className="mt-3 text-xs text-blue-700">
                  <strong>Ejemplo:</strong> Hola {'{{first_name}}'}, tu saldo es {'{{total_balanc}}'} y tienes un descuento de {'{{discount}}'}.
                </p>
              </div>
            )}

            <textarea
              placeholder="Escribe tu mensaje aquí usando variables como {{first_name}}, {{credit}}, {{product}}, etc..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full h-48 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-whatsapp-primary focus:border-transparent resize-none mb-4"
            />

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Retraso entre mensajes (segundos)
              </label>
              <input
                type="number"
                min="3"
                max="60"
                value={delay}
                onChange={(e) => setDelay(parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-whatsapp-primary focus:border-transparent"
              />
            </div>

            <button
              onClick={sendCampaign}
              disabled={sessionStatus !== 'connected' || !message || contacts.length === 0}
              className="w-full bg-whatsapp-primary text-white py-3 rounded-lg font-semibold hover:bg-whatsapp-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Send className="w-5 h-5" />
              Enviar Campaña ({contacts.length} contactos)
            </button>
          </div>
        </div>

        {/* Campaigns History */}
        {campaigns.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Historial de Campañas</h2>
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-800 truncate">
                      {campaign.message.substring(0, 50)}...
                    </p>
                    <p className="text-sm text-gray-600">
                      {campaign.sent} / {campaign.total} enviados
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {campaign.status === 'completed' && (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    {campaign.status === 'running' && (
                      <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                    )}
                    {campaign.status === 'error' && (
                      <AlertCircle className="w-6 h-6 text-red-600" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
