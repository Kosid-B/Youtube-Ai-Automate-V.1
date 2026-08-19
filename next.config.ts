import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// ปักหมุด root ไว้ให้ชัด — next เดา workspace root จาก lockfile ที่หาเจอ
// ซึ่งเดาผิดได้เมื่อมี lockfile อยู่ชั้นบน (เคยเป็นแบบนั้นตอนอยู่ใน repo รวม)
const projectRoot = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  // worker/ รันแยกด้วย tsx ไม่ต้องให้ next พยายาม bundle
  outputFileTracingExcludes: {
    '*': ['./worker/**'],
  },
}

export default nextConfig
