import { NextResponse } from 'next/server'
import { checkConnection, getBrowserInfo } from '@/lib/whatsapp'

export async function GET() {
  try {
    const isConnected = await checkConnection()
    const browserInfo = getBrowserInfo()
    
    return NextResponse.json({
      status: isConnected ? 'connected' : 'disconnected',
      debug: browserInfo,
    })
  } catch (error) {
    console.error('Error checking status:', error)
    return NextResponse.json({ 
      status: 'disconnected',
      error: String(error)
    })
  }
}
