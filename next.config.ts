import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// repo แม่มี lockfile ของตัวเอง ถ้าไม่ปักหมุดไว้ next จะเดา workspace root ผิด
const projectRoot = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  // worker/ รันแยกด้วย tsx ไม่ต้องให้ next พยายาม bundle
  outputFileTracingExcludes: {
    '*': ['./worker/**'],
  },
}

export default nextConfig
