/**
 * อัดตัวอย่างเสียงพากย์ไทยหลายเสียงเป็นไฟล์ .wav ไว้ฟังเทียบก่อนเลือก
 *
 * มีสคริปต์นี้เพราะ `pnpm voices` บอกได้แค่ว่ามีเสียงอะไรบ้าง แต่เลือกเสียงต้องใช้หูฟัง
 * เลือกจากชื่ออย่างเดียวไม่ได้ ชื่อดาวไม่ได้บอกว่าเสียงผู้ชายหรือผู้หญิง เร็วหรือช้า
 *
 * ใช้:
 *   pnpm voice-sample                          → อัด 6 เสียงตัวอย่าง
 *   pnpm voice-sample Kore Puck Leda           → ระบุเอง (ใส่แค่ชื่อท้าย)
 *   pnpm voice-sample --all                    → ทั้ง 30 เสียง (กินโควตามากกว่า)
 *   pnpm voice-sample --text "ข้อความของคุณ"    → เปลี่ยนประโยคตัวอย่าง
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from '../worker/env'

loadEnv()

const { listThaiVoices, synthesize } = await import('../src/lib/tts')

/** ประโยคตัวอย่างมีทั้งสระบน-ล่าง วรรณยุกต์ ตัวเลข และคำควบกล้ำ จะได้ฟังจุดที่มักเพี้ยน */
const DEFAULT_TEXT =
  'สวัสดีครับ ผมจะเล่าเรื่องต้นทุนที่กำลังกินกำไรของคุณอยู่เงียบ ๆ ' +
  'เรือผ่านช่องแคบเหลือหกลำ จากหนึ่งร้อยสามสิบลำ นั่นคือลดลงเก้าสิบห้าเปอร์เซ็นต์'

/** เสียงเริ่มต้นที่ให้ลอง — คละไว้ให้ได้ยินความต่างชัดโดยไม่ต้องอัดครบ 30 */
const DEFAULT_PICKS = ['Achernar', 'Aoede', 'Charon', 'Kore', 'Puck', 'Zephyr']

const args = process.argv.slice(2)
const textFlag = args.indexOf('--text')
const text = textFlag >= 0 ? (args[textFlag + 1] ?? DEFAULT_TEXT) : DEFAULT_TEXT
const wantAll = args.includes('--all')
const picks = args.filter((a) => !a.startsWith('--') && a !== text)

const available = (await listThaiVoices()).map((v) => v.name)
const chirp = available.filter((n) => n.includes('Chirp3-HD'))

const chosen = wantAll
  ? chirp
  : (picks.length > 0 ? picks : DEFAULT_PICKS)
      .map((p) => chirp.find((n) => n.toLowerCase().endsWith(p.toLowerCase())) ?? p)

const unknown = chosen.filter((n) => !available.includes(n))
if (unknown.length > 0) {
  console.error(`❌ ไม่มีเสียงนี้ในบัญชี: ${unknown.join(', ')}`)
  console.error('   ดูรายชื่อที่ใช้ได้ด้วย pnpm voices')
  process.exit(1)
}

const outDir = join(process.cwd(), 'voice-samples')
mkdirSync(outDir, { recursive: true })

console.log(`อัด ${chosen.length} เสียง · ข้อความยาว ${text.length} ตัวอักษร\n`)

for (const name of chosen) {
  const short = name.replace('th-TH-Chirp3-HD-', '')
  try {
    const { bytes, durationSec } = await synthesize(text, {
      voice: { languageCode: 'th-TH', name },
    })
    const file = join(outDir, `${short}.wav`)
    writeFileSync(file, bytes)
    console.log(`✅ ${short.padEnd(16)} ${durationSec.toFixed(1)} วินาที`)
  } catch (error) {
    console.log(`❌ ${short.padEnd(16)} ${(error as Error).message}`)
  }
}

console.log(`\nไฟล์อยู่ที่ ${outDir}`)
console.log('ฟังแล้วเอาชื่อเต็ม (th-TH-Chirp3-HD-<ชื่อ>) ไปใส่ GOOGLE_TTS_VOICE ใน .env.local')
