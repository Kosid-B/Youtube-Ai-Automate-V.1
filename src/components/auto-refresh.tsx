'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * ดึงข้อมูลใหม่เองเมื่อมีงานเดินอยู่
 *
 * Doherty Threshold: ถ้าระบบไม่ตอบสนองภายในราว 400ms ความสนใจจะหลุด
 * งานตัดต่อใช้เวลาเป็นนาที เราจึงชดเชยด้วยการทำให้หน้าจอ "ขยับเอง"
 * ผู้ใช้จะได้ไม่ต้องคอยกดรีเฟรชเพื่อดูว่าคืบหน้าถึงไหน
 *
 * หยุดโพลตอนสลับแท็บไปทำอย่างอื่น ไม่มีใครดูอยู่ก็ไม่ต้องยิง
 */
export function AutoRefresh({ enabled, intervalMs = 10_000 }: { enabled: boolean; intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, intervalMs)

    return () => clearInterval(timer)
  }, [enabled, intervalMs, router])

  return null
}
