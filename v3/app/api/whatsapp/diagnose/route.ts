import { NextResponse } from 'next/server'
import { diagnoseConnection } from '@/lib/whatsapp'

export async function GET() {
  try {
    const diagnosis = await diagnoseConnection()
    return NextResponse.json({
      success: true,
      diagnosis,
    })
  } catch (error) {
    console.error('Error en diagnóstico:', error)
    return NextResponse.json({ 
      success: false,
      error: String(error)
    })
  }
}
