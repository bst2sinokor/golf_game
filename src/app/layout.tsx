import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '모두의 골프게임',
  description: '골프 라운드 게임 자동 계산기',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" style={{ colorScheme: 'light' }}>
      <body style={{ background: '#f1f5f9', color: '#0f172a' }}>{children}</body>
    </html>
  )
}
