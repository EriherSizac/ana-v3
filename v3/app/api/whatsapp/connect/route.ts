import { NextResponse } from 'next/server'
import { initWhatsApp } from '@/lib/whatsapp'

export async function POST() {
  try {
    const result = await initWhatsApp()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error connecting to WhatsApp:', error)
    return NextResponse.json(
      { success: false, message: 'Error al conectar con WhatsApp' },
      { status: 500 }
    )
  }
}
