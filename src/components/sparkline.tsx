/**
 * กราฟเส้นเล็กแบบ SVG ล้วน ไม่พึ่งไลบรารีกราฟ
 *
 * ข้อมูล 30 จุดไม่คุ้มกับการโหลดไลบรารีกราฟทั้งก้อนมาไว้ในบันเดิล
 * และ SVG ตรง ๆ ควบคุมได้ว่าจะวาดอะไรบ้าง ไม่มีอะไรเกินจำเป็นมาเอง
 */
export function Sparkline({
  values,
  target,
  label,
  height = 48,
}: {
  values: number[]
  /** เส้นเป้า — วาดเป็นเส้นประ ตัวเลขไม่มีเกณฑ์เทียบก็บอกอะไรไม่ได้ */
  target?: number
  label: string
  height?: number
}) {
  if (values.length === 0) return null

  const width = 300
  // เพดานต้องรวมเส้นเป้าด้วย ไม่งั้นเป้าที่สูงกว่าข้อมูลจะถูกวาดหลุดกรอบ
  const max = Math.max(1, ...values, target ?? 0)
  const stepX = width / Math.max(1, values.length - 1)
  const y = (v: number) => height - (v / max) * height

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values[values.length - 1]

  return (
    <figure className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="tabular text-sm font-medium">{last}</span>
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-12 w-full"
        role="img"
        aria-label={`${label} — ค่าล่าสุด ${last}`}
      >
        {target !== undefined && (
          <line
            x1="0" x2={width} y1={y(target)} y2={y(target)}
            stroke="var(--color-ink-muted)" strokeWidth="1" strokeDasharray="4 4" opacity="0.5"
          />
        )}
        <path d={line} fill="none" stroke="var(--color-live)" strokeWidth="2"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </figure>
  )
}
