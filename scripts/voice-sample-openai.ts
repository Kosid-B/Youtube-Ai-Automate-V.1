/**
 * อัดตัวอย่างเสียงไทยจาก OpenAI ไว้ฟังเทียบกับ Google ก่อนตัดสินใจเปลี่ยน
 *
 * มีสคริปต์นี้เพราะเอกสารของ OpenAI บอกแค่ว่า "รองรับ 50+ ภาษา" โดยไม่ได้ระบุ
 * ภาษาไทยไว้ชัด — ยืนยันจากเอกสารไม่ได้ ต้องฟังเอง
 *
 * ⚠️ อย่าเปลี่ยนไปใช้ OpenAI เพราะโฆษณาบอกว่ารองรับ ให้ฟังไฟล์ที่ได้จริงก่อน
 * โดยเฉพาะวรรณยุกต์กับสระบน-ล่าง ซึ่งเป็นจุดที่โมเดลที่ไม่ได้เทรนไทยมาดี ๆ จะเพี้ยน
 *
 * ใช้:
 *   pnpm voice-sample-openai                    → อัด 4 เสียงตัวอย่าง
 *   pnpm voice-sample-openai alloy nova         → ระบุเอง
 *   pnpm voice-sample-openai --all              → ทุกเสียง
 *   pnpm voice-sample-openai --text "ข้อความ"    → เปลี่ยนประโยค
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from '../worker/env'

loadEnv()

const { synthesizeOpenAi, OPENAI_VOICES, OPENAI_TTS_MODEL } = await import('../src/lib/tts-openai')

/** ประโยคเดียวกับฝั่ง Google จะได้เทียบกันตรง ๆ — มีวรรณยุกต์ สระบน-ล่าง และตัวเลข */
const DEFAULT_TEXT =
  'สวัสดีครับ ผมจะเล่าเรื่องต้นทุนที่กำลังกินกำไรของคุณอยู่เงียบ ๆ ' +
  'เรือผ่านช่องแคบเหลือหกลำ จากหนึ่งร้อยสามสิบลำ นั่นคือลดลงเก้าสิบห้าเปอร์เซ็นต์'

const DEFAULT_PICKS = ['alloy', 'nova', 'onyx', 'shimmer']

const args = process.argv.slice(2)
const textFlag = args.indexOf('--text')
const text = textFlag >= 0 ? (args[textFlag + 1] ?? DEFAULT_TEXT) : DEFAULT_TEXT
const picks = args.filter((a) => !a.startsWith('--') && a !== text)

const chosen = args.includes('--all')
  ? [...OPENAI_VOICES]
  : picks.length > 0
    ? picks
    : DEFAULT_PICKS

const outDir = join(process.cwd(), 'voice-samples', 'openai')
mkdirSync(outDir, { recursive: true })

console.log(`อัด ${chosen.length} เสียงด้วย ${OPENAI_TTS_MODEL} · ข้อความยาว ${text.length} ตัวอักษร\n`)

let ok = 0

for (const name of chosen) {
  try {
    const { bytes, durationSec } = await synthesizeOpenAi(text, { voice: name })
    writeFileSync(join(outDir, `${name}.wav`), bytes)
    console.log(`✅ ${name.padEnd(10)} ${durationSec.toFixed(1)} วินาที`)
    ok += 1
  } catch (error) {
    console.log(`❌ ${name.padEnd(10)} ${(error as Error).message}`)
  }
}

console.log(`\nไฟล์อยู่ที่ ${outDir}`)

if (ok > 0) {
  console.log(
    '\n👂 ฟังแล้วเทียบกับของ Google (voice-samples/) ก่อนตัดสินใจ\n' +
      '   ฟังตรงวรรณยุกต์กับสระบน-ล่างเป็นพิเศษ — เป็นจุดที่โมเดลที่ไม่ได้เทรนไทยมาดีจะเพี้ยน\n' +
      '   ถ้าดีกว่าจริงค่อยตั้ง TTS_PROVIDER=openai กับ OPENAI_TTS_VOICE=<ชื่อ> ใน .env.local\n' +
      '   ถ้าไม่ดีกว่า อยู่กับ Google ต่อ — มันฟรีในโควตาและยืนยันแล้วว่าอ่านไทยถูก',
  )
}
