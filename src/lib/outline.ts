/**
 * คลิปยาว — วางโครงก่อน เขียนทีละท่อน แล้วต่อกัน
 *
 * ทำไมไม่เขียนรวดเดียว: ขอสคริปต์ยาว 50,000 ตัวอักษรในครั้งเดียว โมเดลจะเริ่มวนซ้ำ
 * และหลุดประเด็นหลังจากไปได้สักพัก เพราะต้องถือโครงเรื่องทั้งหมดไว้ในหัวพร้อมกับ
 * เขียนรายละเอียด · แยกเป็นท่อนละ 5–8 นาทีแล้วให้โมเดลโฟกัสทีละท่อนได้ผลดีกว่ามาก
 *
 * และได้ผลพลอยได้: ท่อนไหนออกมาไม่ดี เขียนใหม่เฉพาะท่อนนั้น ไม่ต้องทิ้งทั้งเรื่อง
 */

/** ท่อนสั้นกว่านี้จะเป็นการสับเรื่องให้ขาดตอน ยาวกว่านี้โมเดลเริ่มวน */
export const SECTION_SECONDS = { min: 240, target: 420, max: 600 } as const

/** เกินนี้คนดูไม่จบ และต้นทุนพุ่งเกินกว่าจะคุ้ม */
export const MAX_SECTIONS = 12

export type OutlineSection = {
  /** ชื่อท่อน — ใช้เป็นหัวข้อย่อยและเป็นหมุดเวลาในคำอธิบายใต้คลิป */
  heading: string
  /** ท่อนนี้ต้องตอบอะไร */
  covers: string
}

export type Outline = {
  title: string
  /** ประโยคเปิดเรื่องทั้งคลิป — ต้องบอกว่าดูจบแล้วได้อะไร */
  promise: string
  sections: OutlineSection[]
}

/** จำนวนท่อนที่ควรมี ให้ได้ความยาวรวมตามเป้า */
export function plannedSections(targetSeconds: number): number {
  const raw = Math.round(targetSeconds / SECTION_SECONDS.target)
  return Math.min(Math.max(raw, 2), MAX_SECTIONS)
}

/** ความยาวที่แต่ละท่อนควรได้ เมื่อแบ่งเวลารวมเท่า ๆ กัน */
export function sectionSeconds(targetSeconds: number, sectionCount: number): number {
  const even = Math.round(targetSeconds / Math.max(sectionCount, 1))
  return Math.min(Math.max(even, SECTION_SECONDS.min), SECTION_SECONDS.max)
}

/**
 * ตรวจโครงก่อนลงมือเขียน — เขียนแล้วค่อยพบว่าโครงพังคือเสียเงินฟรีทั้งเรื่อง
 *
 * ค่าใช้จ่ายของท่อนหนึ่งเท่ากับคลิปสั้นทั้งคลิป การตรวจตรงนี้จึงคุ้มมาก
 */
export function outlineProblems(outline: Outline): string[] {
  const problems: string[] = []

  if (outline.sections.length < 2) {
    problems.push('มีท่อนเดียว — คลิปยาวต้องแบ่งอย่างน้อย 2 ท่อน')
  }

  if (outline.sections.length > MAX_SECTIONS) {
    problems.push(`มี ${outline.sections.length} ท่อน เกิน ${MAX_SECTIONS} ท่อนที่รับได้`)
  }

  if (!outline.promise.trim()) {
    problems.push('ไม่ได้บอกว่าดูจบแล้วได้อะไร')
  }

  // หัวข้อซ้ำ = เขียนออกมาแล้วเนื้อหาจะทับกัน คนดูจะรู้สึกว่าวนที่เดิม
  const headings = outline.sections.map((s) => s.heading.trim())
  const duplicates = headings.filter((h, i) => headings.indexOf(h) !== i)
  if (duplicates.length > 0) {
    problems.push(`หัวข้อย่อยซ้ำ: ${[...new Set(duplicates)].join(', ')}`)
  }

  const empty = outline.sections.filter((s) => !s.covers.trim())
  if (empty.length > 0) {
    problems.push(`${empty.length} ท่อนไม่ได้บอกว่าจะเล่าอะไร`)
  }

  return problems
}

/**
 * ต่อท่อนเป็นสคริปต์เดียว
 *
 * ไม่ใส่ชื่อหัวข้อลงในบทพูด เพราะเป็นบทที่จะถูกอ่านออกเสียง — ผู้ฟังไม่ได้ยินหัวข้อ
 * เขาได้ยินแค่คนพูดประกาศชื่อบทขึ้นมาลอย ๆ ซึ่งฟังแปลก
 * หัวข้อย่อยเอาไปใช้เป็นหมุดเวลาในคำอธิบายแทน
 */
export function joinSections(sections: string[]): string {
  return sections
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * หมุดเวลาสำหรับคำอธิบายใต้คลิป
 *
 * คลิปยาวที่ไม่มีหมุดเวลาคนจะไม่กดดู เพราะมองไม่ออกว่ามีอะไรอยู่ข้างในบ้าง
 * และ YouTube ใช้หมุดเวลาสร้างบทให้ในแถบเลื่อนด้วย
 */
export function chapterMarks(
  headings: string[],
  sectionDurations: number[],
): { time: string; heading: string }[] {
  const marks: { time: string; heading: string }[] = []
  let elapsed = 0

  headings.forEach((heading, i) => {
    marks.push({ time: formatTimestamp(elapsed), heading })
    elapsed += sectionDurations[i] ?? 0
  })

  return marks
}

/**
 * แปลงความยาวแต่ละท่อน "เป็นตัวอักษร" ให้กลายเป็น "เป็นวินาที" ด้วยเวลาจริงของฉาก
 *
 * ทำไมไม่คูณอัตราอ่านเอาตรง ๆ: เวลาจริงมาจากไฟล์เสียงที่ TTS คืนมา ซึ่งไม่เท่ากับ
 * ตัวอักษร × อัตราอ่าน — ตัวเลข ชื่อเฉพาะ และเครื่องหมายกินเวลาไม่เท่ากับอักษรทั่วไป
 * คลิป 45 นาทีคลาดเคลื่อนสะสมจนหมุดท้าย ๆ เลื่อนไปเป็นนาที ซึ่งแย่กว่าไม่มีหมุด
 *
 * ฉากหนึ่งคร่อมสองท่อนได้ (ตัวแบ่งฉากรวมย่อหน้าสั้นเข้าด้วยกัน) จึงเฉลี่ยเวลาของฉากนั้น
 * ให้แต่ละท่อนตามสัดส่วนตัวอักษรที่ทับกัน
 */
export function sectionDurationsFromScenes(
  sectionChars: number[],
  sceneChars: number[],
  sceneDurations: number[],
): number[] {
  const durations = new Array<number>(sectionChars.length).fill(0)

  // ขอบเขตของแต่ละท่อนบนแกนตัวอักษรรวม
  let bound = 0
  const bounds = sectionChars.map((chars) => (bound += chars))

  let cursor = 0

  sceneChars.forEach((chars, i) => {
    const seconds = sceneDurations[i] ?? 0
    if (chars <= 0) return

    const start = cursor
    const end = cursor + chars
    cursor = end

    let from = start
    for (let s = 0; s < bounds.length && from < end; s += 1) {
      const sectionEnd = bounds[s]
      if (sectionEnd <= from) continue

      const to = Math.min(end, sectionEnd)
      durations[s] += (seconds * (to - from)) / chars
      from = to
    }

    // ตัวอักษรที่ล้นเกินท่อนสุดท้าย (ตัวแบ่งฉากตัดช่องว่างทิ้งบ้าง) โยนเข้าท่อนสุดท้าย
    if (from < end && durations.length > 0) {
      durations[durations.length - 1] += (seconds * (end - from)) / chars
    }
  })

  return durations
}

/** YouTube ต้องการ m:ss หรือ h:mm:ss และหมุดแรกต้องเป็น 0:00 เสมอ */
function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
