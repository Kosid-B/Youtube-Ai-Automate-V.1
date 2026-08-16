/**
 * Originality Guard — กันคลิปโดน YouTube ตีเป็น Inauthentic / Reused Content (นโยบาย ก.ค. 2025)
 *
 * ทุกเส้นทางที่นำสคริปต์ไป render หรืออัป ต้องผ่านฟังก์ชันนี้ก่อน
 * verdict 'block' = หยุดที่ API layer ตอบ 409 — ไม่มี flag ให้ผู้ใช้กดข้าม
 *
 * ⚠️ เกณฑ์ในไฟล์นี้เป็นตัวกันช่องโดนตัดรายได้ แก้ได้แต่ต้องคุยกับเจ้าของโปรเจคก่อน
 */

/** similarity ตั้งแต่ค่านี้ขึ้นไป = block */
export const SIMILARITY_BLOCK = 0.4
/** similarity ตั้งแต่ค่านี้ขึ้นไป (แต่ยังไม่ถึง block) = ให้คนตรวจก่อน */
export const SIMILARITY_REVIEW = 0.25
/** checklist ต้องผ่านอย่างน้อยกี่ข้อจาก 5 */
export const CHECKLIST_MIN_PASS = 3

export type OriginalityVerdict = 'pass' | 'review' | 'block'

export type ChecklistKey =
  | 'own_angle'
  | 'verifiable_facts'
  | 'own_structure'
  | 'own_production'
  | 'added_value'

export interface ChecklistItem {
  key: ChecklistKey
  /** คำถามที่ใช้ถามตัวเอง (แสดงใน UI) */
  question: string
}

/** เกณฑ์ 5 ข้อ — ต้องผ่าน ≥ 3 ข้อ */
export const CHECKLIST: readonly ChecklistItem[] = [
  { key: 'own_angle', question: 'มีมุมมองหรือประสบการณ์ของช่องเองที่หาจากที่อื่นไม่ได้ไหม' },
  { key: 'verifiable_facts', question: 'มีข้อมูลหรือตัวเลขที่ตรวจแหล่งที่มาได้ไหม' },
  { key: 'own_structure', question: 'ลำดับการเล่าเรื่องต่างจากต้นฉบับที่อ้างอิงไหม' },
  { key: 'own_production', question: 'เสียงและภาพผลิตเองทั้งหมดไหม (ไม่ใช่คลิปคนอื่นตัดต่อ)' },
  { key: 'added_value', question: 'คนดูได้อะไรเพิ่มจากที่หาอ่านเองได้ไหม' },
]

export interface OriginalityInput {
  /** สคริปต์ที่จะตรวจ */
  body: string
  /** สคริปต์อื่นในช่อง/องค์กรเดียวกันที่เอามาเทียบความซ้ำ */
  corpus: string[]
  /** ผลเช็ค checklist — ข้อที่ไม่ได้ส่งมาถือว่าไม่ผ่าน */
  checklist: Partial<Record<ChecklistKey, boolean>>
}

export interface OriginalityReport {
  verdict: OriginalityVerdict
  /** similarity สูงสุดที่เจอ (0–1) */
  similarity: number
  /** index ใน corpus ที่ซ้ำมากที่สุด — -1 ถ้า corpus ว่าง */
  closestIndex: number
  checklistPassed: number
  checklistTotal: number
  failedChecks: ChecklistKey[]
  /** เหตุผลที่ block/review เขียนให้ผู้ใช้อ่านรู้เรื่อง */
  reasons: string[]
  checkedAt: string
}

/**
 * ตัดเป็น n-gram ระดับตัวอักษร ไม่ใช่ระดับคำ
 * เพราะภาษาไทยไม่เว้นวรรคระหว่างคำ การตัดคำต้องใช้ dictionary ซึ่งพลาดง่ายกว่า
 */
const SHINGLE_SIZE = 5

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // ตัดเครื่องหมายวรรคตอนทิ้ง เหลือตัวอักษร/ตัวเลข/ช่องว่าง (คงอักษรไทยไว้)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
}

function shingles(text: string): Set<string> {
  const normalized = normalize(text)
  const out = new Set<string>()
  if (normalized.length < SHINGLE_SIZE) {
    if (normalized.length > 0) out.add(normalized)
    return out
  }
  for (let i = 0; i <= normalized.length - SHINGLE_SIZE; i++) {
    out.add(normalized.slice(i, i + SHINGLE_SIZE))
  }
  return out
}

/** Jaccard similarity บน character n-gram — คืนค่า 0–1 */
export function similarity(a: string, b: string): number {
  const setA = shingles(a)
  const setB = shingles(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  // วนตัวที่เล็กกว่าเพื่อให้เร็วขึ้นเมื่อสคริปต์ยาวไม่เท่ากัน
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA]
  for (const gram of small) {
    if (large.has(gram)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function checkOriginality(input: OriginalityInput): OriginalityReport {
  let maxSimilarity = 0
  let closestIndex = -1

  input.corpus.forEach((other, index) => {
    const score = similarity(input.body, other)
    if (score > maxSimilarity) {
      maxSimilarity = score
      closestIndex = index
    }
  })

  const failedChecks = CHECKLIST.filter((item) => input.checklist[item.key] !== true).map(
    (item) => item.key,
  )
  const checklistPassed = CHECKLIST.length - failedChecks.length

  const reasons: string[] = []
  let verdict: OriginalityVerdict = 'pass'

  if (maxSimilarity >= SIMILARITY_BLOCK) {
    verdict = 'block'
    reasons.push(
      `เนื้อหาซ้ำกับสคริปต์เดิม ${Math.round(maxSimilarity * 100)}% (เพดานที่ยอมได้คือ ${Math.round(
        SIMILARITY_BLOCK * 100,
      )}%) — เขียนใหม่ให้ต่างจากเดิมก่อน`,
    )
  }

  if (checklistPassed < CHECKLIST_MIN_PASS) {
    verdict = 'block'
    reasons.push(
      `ผ่านเกณฑ์ความเป็นต้นฉบับ ${checklistPassed}/${CHECKLIST.length} ข้อ ต้องผ่านอย่างน้อย ${CHECKLIST_MIN_PASS} ข้อ`,
    )
  }

  if (verdict === 'pass' && maxSimilarity >= SIMILARITY_REVIEW) {
    verdict = 'review'
    reasons.push(
      `เนื้อหาใกล้เคียงสคริปต์เดิม ${Math.round(maxSimilarity * 100)}% — ยังผ่านได้ แต่ควรอ่านทวนก่อนอัป`,
    )
  }

  return {
    verdict,
    similarity: maxSimilarity,
    closestIndex,
    checklistPassed,
    checklistTotal: CHECKLIST.length,
    failedChecks,
    reasons,
    checkedAt: new Date().toISOString(),
  }
}

/** true = ห้ามไปต่อ (render / อัป) */
export function isBlocked(report: OriginalityReport): boolean {
  return report.verdict === 'block'
}
