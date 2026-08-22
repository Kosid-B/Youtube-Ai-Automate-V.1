import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ห้ามอ่าน process.env ตอนโหลดโมดูล
 *
 * `const X = Number(process.env.FOO)` ระดับบนสุดของไฟล์จะถูกตรึงตั้งแต่ ESM
 * ประเมิน import ซึ่งเกิด "ก่อน" loadEnv() เสมอ (worker/index.ts ถึงต้องใช้
 * dynamic import) ผลคือได้ค่า default ไปทั้งที่ตั้งไว้ใน .env.local แล้ว
 * โดยไม่มีอะไรฟ้อง — ไปโผล่เป็นพฤติกรรมผิดที่จุดใช้งานแทน
 *
 * กับดักนี้กัดโปรเจคนี้มาแล้ว 4 รอบ:
 *   1. DAILY_QUOTA_LIMIT ใน lib/quota.ts (เป็นที่มาของ worker/env.ts)
 *   2. MAX_COST_USD_PER_GENERATION ใน video/router.ts
 *   3. REQUEST_TIMEOUT_MS ใน video/http.ts — เทสต์ timeout ค้าง 30 วินาที
 *      ทั้งที่ตั้ง 150ms ไว้
 *   4. POLL_DEADLINE_MS ใน worker/handlers/video-poll.ts
 *
 * ทุกครั้งเจอตอนเขียนเทสต์ ไม่ใช่ตอน review — เพราะโค้ดอ่านแล้วดูถูกต้อง
 * เทสต์นี้จึงกันไว้ที่ระดับ "รูปแบบการเขียน" แทนที่จะรอให้ใครสังเกตเห็น
 *
 * วิธีที่ถูก: เขียนเป็นฟังก์ชันที่อ่านตอนเรียก
 *   function maxCostUsd(): number {
 *     const raw = Number(process.env.MAX_VIDEO_COST_USD)
 *     return Number.isFinite(raw) && raw > 0 ? raw : 5
 *   }
 */

const ROOTS = ['src', 'worker', 'scripts']

/**
 * ไฟล์ที่ยกเว้นได้ พร้อมเหตุผล — ห้ามเพิ่มโดยไม่เขียนว่าทำไม
 * ทุกรายการที่นี่คือหนี้ที่ต้องมีคนตอบได้ว่าปลอดภัยเพราะอะไร
 */
const ALLOWED: Record<string, string> = {
  // อ่าน env เพื่อ "ตรวจว่าตั้งหรือยัง" ไม่ได้เอาค่าไปใช้เป็นพฤติกรรม
  // และสคริปต์นี้เรียก loadEnv() เป็นบรรทัดแรกก่อน import อะไรทั้งสิ้น
  'scripts/preflight.ts': 'สคริปต์ CLI ที่ loadEnv() ก่อน import ทุกอย่าง',

  // worker/index.ts เรียก loadEnv() แล้วค่อย `await import('./run')` — dynamic import
  // จึงถูกประเมิน "หลัง" env พร้อมแล้วเสมอ ไฟล์นี้คือฝั่งที่ปลอดภัยของกลไกนั้นเอง
  // เงื่อนไขที่ทำให้ยกเว้นได้ (ไม่มีใคร import แบบ static) มีเทสต์ตรวจไว้ข้างล่าง
  'worker/run.ts': 'ถูก dynamic import หลัง loadEnv() ใน worker/index.ts',
}

async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = []

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      found.push(...(await tsFiles(path)))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(path)
    }
  }

  return found
}

/**
 * จับเฉพาะการประกาศตัวแปรระดับบนสุดที่อ่าน env
 *
 * ระดับบนสุด = ไม่มีการเว้นวรรคนำหน้า · ข้างในฟังก์ชันจะมีย่อหน้าเสมอ
 * จึงแยกสองกรณีออกจากกันได้โดยไม่ต้อง parse AST
 */
const TOP_LEVEL_ENV = /^(?:export\s+)?(?:const|let|var)\s+\w+[^\n]*\bprocess\.env\b/gm

describe('ห้ามอ่าน env ตอนโหลดโมดูล', () => {
  it('ไม่มีไฟล์ไหนประกาศค่าคงที่ระดับบนสุดจาก process.env', async () => {
    const offenders: string[] = []

    for (const root of ROOTS) {
      for (const file of await tsFiles(root)) {
        const rel = relative('.', file)
        if (ALLOWED[rel]) continue

        const source = await readFile(file, 'utf8')
        const matches = source.match(TOP_LEVEL_ENV)

        if (matches) {
          offenders.push(`${rel}: ${matches.map((m) => m.trim()).join(' · ')}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  /**
   * ข้อยกเว้นของ worker/run.ts ตั้งอยู่บนเงื่อนไขเดียว: ต้องไม่มีใคร import แบบ static
   * ถ้าวันหนึ่งมีไฟล์ทำแบบนั้น มันจะถูกประเมินก่อน loadEnv() ทันที
   * และข้อยกเว้นด้านบนจะกลายเป็นคำโกหกโดยไม่มีใครรู้ — ตรวจเงื่อนไขนั้นตรงนี้
   */
  it('worker/run.ts ต้องถูกเรียกด้วย dynamic import เท่านั้น', async () => {
    const statics: string[] = []

    for (const root of ROOTS) {
      for (const file of await tsFiles(root)) {
        const source = await readFile(file, 'utf8')
        if (/^import\s[^\n]*['"][^'"]*\/run['"]/m.test(source)) {
          statics.push(relative('.', file))
        }
      }
    }

    expect(statics).toEqual([])
  })

  /** ตัวเทสต์เองต้องจับได้จริง ไม่งั้นมันคือเทสต์ที่ผ่านเปล่า ๆ */
  it('รูปแบบที่ใช้จับ ต้องจับของผิดได้และปล่อยของถูกไป', () => {
    const bad = [
      'const TIMEOUT = Number(process.env.FOO) || 30_000',
      'export const KEY = process.env.BAR ?? "x"',
      'let limit = Number(process.env.BAZ)',
    ]
    const good = [
      'function timeout() {\n  const raw = Number(process.env.FOO)\n  return raw\n}',
      '  const key = process.env.BAR',
      'if (process.env.NODE_ENV === "test") {}',
    ]

    for (const line of bad) {
      expect(line.match(new RegExp(TOP_LEVEL_ENV.source, 'gm'))).not.toBeNull()
    }
    for (const line of good) {
      expect(line.match(new RegExp(TOP_LEVEL_ENV.source, 'gm'))).toBeNull()
    }
  })
})
