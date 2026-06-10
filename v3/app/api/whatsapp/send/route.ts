import { NextResponse } from 'next/server'
import { sendBulkMessages, checkConnection } from '@/lib/whatsapp'

export async function POST(request: Request) {
  try {
    const { message, contacts, delay } = await request.json()

    if (!message || !contacts || contacts.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Faltan parámetros requeridos' },
        { status: 400 }
      )
    }

    // Verificar que WhatsApp esté conectado antes de enviar
    const isConnected = await checkConnection()
    if (!isConnected) {
      return NextResponse.json(
        { success: false, message: 'WhatsApp no está conectado. Por favor, conecta WhatsApp primero.' },
        { status: 400 }
      )
    }

    const result = await sendBulkMessages(contacts, message, delay || 5)

    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      total: contacts.length,
    })
  } catch (error) {
    console.error('Error sending messages:', error)
    return NextResponse.json(
      { success: false, message: 'Error al enviar mensajes' },
      { status: 500 }
    )
  }
}
