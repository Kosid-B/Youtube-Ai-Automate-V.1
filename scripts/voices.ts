/**
 * แสดงรายชื่อเสียงพากย์ไทยที่บัญชี Google ของเราเรียกใช้ได้จริง
 *
 * มีสคริปต์นี้เพราะชื่อเสียงเดาไม่ได้ (เปลี่ยนตามรุ่นและภูมิภาค) และคำสั่งบรรทัดเดียว
 * ที่ต้องพิมพ์เองยาวจนพิมพ์ผิดง่ายกว่าจะได้คำตอบ
 */
import { loadEnv } from '../worker/env'

loadEnv()

const { listThaiVoices } = await import('../src/lib/tts')

const voices = await listThaiVoices()
const chirp = voices.filter((v) => v.name.includes('Chirp3-HD'))

console.table(voices)

if (chirp.length > 0) {
  console.log(`\n✅ เอาชื่อใดชื่อหนึ่งไปใส่ GOOGLE_TTS_VOICE ใน .env.local:\n`)
  for (const v of chirp) console.log(`   ${v.name}`)
} else {
  console.log('\n⚠️  ไม่พบเสียง Chirp3-HD ในบัญชีนี้ — ใช้ชื่อจากตารางข้างบนแทนได้')
}
