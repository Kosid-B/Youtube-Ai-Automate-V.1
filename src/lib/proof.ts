/**
 * หลักฐานที่ช่องนี้อ้างได้จริง
 *
 * ทำไมต้องมีตารางเก็บไว้ ไม่ปล่อยให้โมเดลคิดตัวเลขเอง:
 *
 * สไตล์การเขียนแบบ direct-response เดินด้วย "ตัวเลขที่เจาะจง" เป็นหลัก
 * (หน้าขายที่ได้ผลจะมีตัวเลขอยู่เหนือปุ่มเสมอ) แต่กติกาของโปรเจคนี้เอง
 * ห้ามใส่ตัวเลขที่ยังไม่ได้ตรวจแหล่งที่มา (HOOK_RULES ใน idea-angles.ts
 * และ skill data-verification-10-rules)
 *
 * สองอย่างนี้ขัดกันตรง ๆ ถ้าไม่มีที่เก็บ — ทางออกคือเปลี่ยนคำสั่งจาก
 * "ห้ามใช้ตัวเลข" เป็น "ใช้ได้เฉพาะตัวเลขในรายการนี้" เจ้าของช่องเป็นคนใส่
 * และใส่พร้อมที่มาเสมอ เพื่อให้ตอบได้เมื่อมีคนถามว่าเอามาจากไหน
 *
 * ไม่มีหลักฐานสักข้อ = เขียนคลิปได้ แต่ห้ามมีตัวเลขใด ๆ ในบทพูด
 * ซึ่งถูกแล้ว — ช่องที่ยังไม่มีผลงานไม่ควรพูดเหมือนมี
 */

export type ProofPoint = {
  /** คำกล่าวอ้างสั้น ๆ อย่างที่จะพูดในคลิป */
  claim: string
  /** เอามาจากไหน — ต้องตอบได้เมื่อมีคนถาม ไม่ใช่ "จากประสบการณ์" */
  source: string
}

export const MAX_PROOF_POINTS = 6
export const MAX_CLAIM_CHARS = 80
export const MAX_SOURCE_CHARS = 200

/** อ่านค่าจากฐานข้อมูล (jsonb) แบบไม่เชื่อรูปร่างล่วงหน้า */
export function parseProofPoints(raw: unknown): ProofPoint[] {
  if (!Array.isArray(raw)) return []

  return raw.filter(
    (item): item is ProofPoint =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ProofPoint).claim === 'string' &&
      typeof (item as ProofPoint).source === 'string' &&
      (item as ProofPoint).claim.trim().length > 0 &&
      (item as ProofPoint).source.trim().length > 0,
  )
}

/**
 * ตรวจก่อนบันทึก
 *
 * ที่มาว่าง = ข้อนั้นใช้ไม่ได้ ไม่ใช่ "ใส่ทีหลังได้" — ทั้งระบบนี้มีอยู่เพื่อบังคับ
 * ให้ตัวเลขมีที่มา ยอมให้เว้นว่างเมื่อไรก็เท่ากับไม่มีระบบนี้
 */
export function proofProblems(points: ProofPoint[]): string[] {
  const problems: string[] = []

  if (points.length > MAX_PROOF_POINTS) {
    problems.push(`ใส่ได้ไม่เกิน ${MAX_PROOF_POINTS} ข้อ`)
  }

  points.forEach((point, i) => {
    const no = i + 1
    if (!point.claim.trim()) problems.push(`ข้อ ${no}: ยังไม่ได้เขียนคำกล่าวอ้าง`)
    if (point.claim.length > MAX_CLAIM_CHARS) {
      problems.push(`ข้อ ${no}: คำกล่าวอ้างยาวเกิน ${MAX_CLAIM_CHARS} ตัวอักษร`)
    }
    if (!point.source.trim()) {
      problems.push(`ข้อ ${no}: ต้องบอกที่มา — ตัวเลขที่ตอบไม่ได้ว่ามาจากไหน ใช้ไม่ได้`)
    }
    if (point.source.length > MAX_SOURCE_CHARS) {
      problems.push(`ข้อ ${no}: ที่มายาวเกิน ${MAX_SOURCE_CHARS} ตัวอักษร`)
    }
  })

  return problems
}

/** มีตัวเลขอยู่ในคำกล่าวอ้างไหม — ใช้เตือนว่ายังไม่มีหลักฐานเชิงตัวเลขให้ใช้ */
export function hasNumber(text: string): boolean {
  return /[0-9๐-๙]/.test(text)
}

/**
 * ส่วนของ prompt ที่บอกว่าอ้างอะไรได้บ้าง
 *
 * เขียนคำสั่งให้เด็ดขาดตรงนี้ ไม่ใช่ฝากไว้ในกฎรวม — ข้อนี้คือข้อที่โมเดลชอบฝ่าฝืน
 * ที่สุด เพราะการแต่งตัวเลขทำให้บทพูดฟังดูดีขึ้นทันทีโดยไม่มีอะไรค้าน
 */
export function proofContext(points: ProofPoint[]): string {
  if (points.length === 0) {
    return [
      'หลักฐานที่ช่องนี้อ้างได้: ยังไม่มี',
      '→ ห้ามใส่ตัวเลขใด ๆ ในบทพูด (ยอดวิว จำนวนลูกค้า เปอร์เซ็นต์ จำนวนเงิน ระยะเวลา)',
      '→ ใช้การอธิบายกลไกและตัวอย่างที่ไม่ต้องอ้างตัวเลขแทน',
    ].join('\n')
  }

  return [
    'หลักฐานที่ช่องนี้อ้างได้ (ใช้ได้เฉพาะในรายการนี้เท่านั้น):',
    ...points.map((p) => `- ${p.claim}  [ที่มา: ${p.source}]`),
    '',
    '→ ตัวเลขที่ไม่ได้อยู่ในรายการนี้ ห้ามพูดเด็ดขาด แม้จะฟังดูสมเหตุสมผล',
    '→ ห้ามปัดเศษหรือขยายตัวเลขในรายการให้ดูดีขึ้น ใช้ตามที่เขียนไว้',
    '→ พูดตัวเลขแล้วต้องพูดข้อจำกัดติดกันในประโยคเดียวกันหรือประโยคถัดไปทันที',
  ].join('\n')
}
