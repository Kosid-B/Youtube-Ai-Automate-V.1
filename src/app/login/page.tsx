'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * เข้าสู่ระบบด้วยลิงก์ทางอีเมล
 *
 * Hick's Law: หน้านี้มีทางเลือกเดียวและปุ่มเดียว
 * ไม่มีรหัสผ่าน = ไม่มีหน้าลืมรหัสผ่าน ไม่มีกฎความยาวรหัส ไม่มีอะไรให้ลูกค้าพลาด
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setState('sending')

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (signInError) {
      // Postel's Law: บอกสิ่งที่ผู้ใช้ทำต่อได้ ไม่ใช่โยนข้อความจากระบบมาดิบ ๆ
      setError('ส่งลิงก์ไม่สำเร็จ ลองตรวจอีเมลอีกครั้งหรือลองใหม่ในอีกสักครู่')
      setState('idle')
      return
    }

    setState('sent')
  }

  if (state === 'sent') {
    return (
      <main className="mx-auto max-w-md px-5 py-20">
        <h1 className="text-2xl font-semibold">ส่งลิงก์ไปแล้ว</h1>
        <p className="mt-3 leading-relaxed text-ink-muted">
          เปิดอีเมล <span className="text-ink">{email}</span> แล้วกดลิงก์เพื่อเข้าใช้งาน
          ลิงก์ใช้ได้ครั้งเดียว ถ้าไม่เจอให้ดูในกล่องจดหมายขยะ
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">เข้าใช้งาน yt-factory</h1>
      <p className="mt-2 text-sm text-ink-muted">กรอกอีเมล เราจะส่งลิงก์เข้าใช้งานไปให้</p>

      <form onSubmit={submit} className="mt-8">
        <label htmlFor="email" className="block text-sm font-medium">
          อีเมล
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3.5 py-3 outline-none placeholder:text-ink-muted/60 focus:border-ink-muted"
        />

        {error && <p className="mt-3 text-sm text-block">{error}</p>}

        {/* Fitts's Law: ปุ่มหลักเต็มความกว้างและสูงพอกดบนมือถือได้ถนัด */}
        <button
          type="submit"
          disabled={state === 'sending'}
          className="mt-5 w-full rounded-lg bg-ink px-4 py-3 font-medium text-base-900 transition disabled:opacity-50"
          style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
        >
          {state === 'sending' ? 'กำลังส่ง…' : 'ส่งลิงก์เข้าใช้งาน'}
        </button>
      </form>
    </main>
  )
}
