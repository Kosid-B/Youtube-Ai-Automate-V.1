'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { JOB_COST } from '@/lib/credits'
import { FORMATS, type VideoFormat } from '@/lib/formats'

type Channel = { id: string; name: string }

export function NewScriptForm({ channels, credits }: { channels: Channel[]; credits: number }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [format, setFormat] = useState<VideoFormat>('long')

  const cost = JOB_COST.script_generate
  const enough = credits >= cost

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/scripts/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel_id: form.get('channel_id'),
        title: String(form.get('title') ?? '').trim(),
        brief: String(form.get('brief') ?? '').trim() || undefined,
        format,
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? 'สั่งเขียนสคริปต์ไม่สำเร็จ ลองใหม่อีกครั้ง')
      setPending(false)
      return
    }

    // งานเข้าคิวแล้ว ความคืบหน้าดูได้ที่หน้าสายการผลิต
    router.push('/')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {/*
        Hick's Law: สองตัวเลือก แสดงเป็นปุ่มให้เห็นพร้อมกันเลย เร็วกว่า dropdown ที่ต้องกดเปิดก่อน
        Law of Similarity: ปุ่มที่เลือกอยู่ต่างจากอีกปุ่มชัดเจน ไม่ต้องเพ่ง
      */}
      <fieldset>
        <legend className="text-sm text-ink-muted">รูปแบบคลิป</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(Object.keys(FORMATS) as VideoFormat[]).map((key) => {
            const spec = FORMATS[key]
            const active = format === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFormat(key)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${
                  active ? 'border-ink bg-surface-2' : 'border-line hover:border-ink-muted'
                }`}
              >
                <span className="block text-sm font-medium">{spec.label}</span>
                {/* บอกความยาวจริงไปเลย ผู้ใช้จะได้ไม่ต้องเดาว่า "สั้น" คือแค่ไหน */}
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {key === 'short'
                    ? `~${spec.targetSeconds} วินาที · YouTube Shorts`
                    : `~${Math.round(spec.targetSeconds / 60)} นาที`}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {channels.length > 1 && (
        <div>
          <label htmlFor="channel_id" className="block text-sm font-medium">
            ช่อง
          </label>
          <select
            id="channel_id"
            name="channel_id"
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3.5 py-3 outline-none focus:border-ink-muted"
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {channels.length === 1 && <input type="hidden" name="channel_id" value={channels[0].id} />}

      <div>
        <label htmlFor="title" className="block text-sm font-medium">
          หัวข้อคลิป
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="เช่น ทำไมร้านกาแฟถึงเจ๊งในปีแรก"
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3.5 py-3 outline-none placeholder:text-ink-muted/60 focus:border-ink-muted"
        />
      </div>

      <div>
        <label htmlFor="brief" className="block text-sm font-medium">
          มุมที่อยากเล่า
          <span className="ml-2 text-xs text-ink-muted">ไม่บังคับ</span>
        </label>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          ใส่ประสบการณ์หรือข้อมูลที่คนอื่นไม่มี ยิ่งเฉพาะเจาะจง คลิปยิ่งผ่านด่านเนื้อหาซ้ำได้ง่าย
        </p>
        <textarea
          id="brief"
          name="brief"
          rows={4}
          placeholder="เช่น ผมเคยลงทุนร้านกาแฟแล้วเจ๊งใน 8 เดือน ต้นทุนที่ฆ่าเราคือของเสียในครัว ไม่ใช่ค่าเช่า"
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3.5 py-3 leading-relaxed outline-none placeholder:text-ink-muted/60 focus:border-ink-muted"
        />
      </div>

      {/* บอกราคาก่อนกด ไม่ใช่ให้ไปเจอตอนเครดิตหาย */}
      <p className="text-sm text-ink-muted">
        ใช้ <span className="tabular text-ink">{cost}</span> เครดิต · เหลืออยู่{' '}
        <span className={`tabular ${enough ? 'text-ink' : 'text-block'}`}>{credits}</span>
      </p>

      {error && <p className="text-sm text-block">{error}</p>}

      <button
        type="submit"
        disabled={pending || !enough}
        className="w-full rounded-lg px-4 py-3 font-medium transition disabled:opacity-50"
        style={{ color: 'var(--color-base)', background: 'var(--color-ink)' }}
      >
        {pending ? 'กำลังส่งเข้าคิว…' : enough ? 'ให้ AI เขียนสคริปต์' : 'เครดิตไม่พอ'}
      </button>
    </form>
  )
}
