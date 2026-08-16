/**
 * สร้าง slug ให้องค์กรโดยไม่ต้องถามผู้ใช้
 *
 * Tesler's Law: ชื่อองค์กรภาษาไทยแปลงเป็น a-z ตรง ๆ ไม่ได้
 * แทนที่จะโยนกฎ "ต้องเป็นภาษาอังกฤษ 3–40 ตัว" ให้ผู้ใช้แก้เอง ระบบสร้างให้เลย
 */

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** ต้องตรงกับ regex ที่ create_org ตรวจไว้ฝั่งฐานข้อมูล */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug)
}

/**
 * @param name  ชื่อที่ผู้ใช้กรอก (ภาษาอะไรก็ได้)
 * @param randomSuffix ส่วนสุ่มท้าย slug — รับเข้ามาเพื่อให้เทสได้
 */
export function slugify(name: string, randomSuffix: string = randomToken(6)): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    // เก็บเฉพาะ a-z 0-9 ส่วนอักษรไทยและอื่น ๆ กลายเป็นขีด
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)

  const prefix = base.length >= 2 ? base : 'org'
  const slug = `${prefix}-${randomSuffix}`

  // กันกรณีสุดขั้วที่ยังไม่ผ่าน เช่นชื่อยาวจนถูกตัดแล้วลงท้ายด้วยขีด
  return isValidSlug(slug) ? slug : `org-${randomSuffix}`
}

export function randomToken(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join('')
}
