/**
 * ตัวเลขสี่ตัวบนหัวหน้าจอ — ตอบคำถามที่เจ้าของถามทุกครั้งที่เปิดหน้านี้
 *
 * Selective Attention: อ่านให้จบภายใน 5 วินาที ก่อนจะเริ่มไล่อ่านรายการข้างล่าง
 * Von Restorff: มีสีได้ตัวเดียวคือตัวที่ต้องลงมือทำ ที่เหลือเทาหมด
 *               ถ้าให้สีทุกตัวจะไม่มีตัวไหนสะดุดตา
 */
export type Kpi = {
  label: string
  value: string
  /** บรรทัดเล็กใต้ตัวเลข — เทียบกับอะไรสักอย่างเสมอ ตัวเลขลอย ๆ ไม่บอกอะไร */
  context: string
  /** true = ต้องลงมือทำ (แดง) · ที่เหลือเทา */
  alert?: boolean
  /** ค่าประมาณ ไม่ใช่ตัวเลขจริง — ติดดอกจันไว้ไม่ให้เอาไปใช้ตัดสินใจเรื่องเงิน */
  estimated?: boolean
  /** 0–1 แสดงเป็นแถบใต้ตัวเลข (Goal-Gradient: เห็นว่าใกล้ถึงแล้วจะเร่ง) */
  progress?: number
}

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
      {items.map((kpi) => (
        <div key={kpi.label} className="bg-surface px-4 py-3.5">
          <dt className="text-xs text-ink-muted">{kpi.label}</dt>
          <dd
            className="mt-1 text-2xl font-semibold tabular tracking-tight"
            style={kpi.alert ? { color: 'var(--color-block)' } : undefined}
          >
            {kpi.value}
            {kpi.estimated && (
              <span className="ml-1 align-super text-xs font-normal text-ink-muted" title="ค่าประมาณ">
                *
              </span>
            )}
          </dd>

          {kpi.progress !== undefined && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${Math.min(100, Math.round(kpi.progress * 100))}%`,
                  background: 'var(--color-live)',
                }}
              />
            </div>
          )}

          <p className="mt-1.5 text-xs leading-snug text-ink-muted">{kpi.context}</p>
        </div>
      ))}
    </dl>
  )
}
