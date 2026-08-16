import type { Metadata } from 'next'
import { IBM_Plex_Sans_Thai, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-thai',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
})

export const metadata: Metadata = {
  title: 'yt-factory',
  description: 'สายการผลิตคลิป YouTube ด้วย AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${plexThai.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  )
}
