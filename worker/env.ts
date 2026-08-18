/**
 * โหลด .env.local เข้ามาเอง แทนที่จะพึ่ง flag --env-file-if-exists ของ node
 *
 * flag ตัวนั้นพึ่งไม่ได้ข้ามเวอร์ชัน: มันเงียบเมื่อหาไฟล์ไม่เจอ (ตั้งใจ) และมีรายงาน
 * ว่าไม่โหลดให้เมื่อลำดับ argument ไม่เป็นไปตามที่คาด ผลคือคีย์หายโดยไม่มีอะไรฟ้อง
 * จนไปโผล่เป็น error ที่จุดใช้งานแทน ซึ่งไล่ย้อนกลับมาหาสาเหตุยาก
 *
 * process.loadEnvFile() เป็น API ในตัวของ node (ไม่ต้องลง dotenv) เรียกตรงนี้
 * ครั้งเดียวก่อนทุกอย่าง แล้วบอกให้ชัดว่าโหลดจากไฟล์ไหน หรือไม่เจอไฟล์
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** ค่าที่ตั้งไว้ในเชลล์อยู่แล้วชนะไฟล์เสมอ — process.loadEnvFile ไม่ทับของเดิม */
export function loadEnv(file = '.env.local'): void {
  const path = resolve(process.cwd(), file)

  if (!existsSync(path)) {
    console.warn(`⚠️  ไม่พบ ${file} ที่ ${process.cwd()} — ใช้ค่าจาก environment ของเชลล์เท่านั้น`)
    return
  }

  process.loadEnvFile(path)
}
