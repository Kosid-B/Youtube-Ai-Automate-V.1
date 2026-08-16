import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  // next-env.d.ts เป็นไฟล์ที่ next สร้างเอง ห้ามแก้ จึงไม่ต้อง lint
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // พารามิเตอร์ที่ขึ้นต้นด้วย _ = ตั้งใจไม่ใช้ (ค้างไว้รอ handler ที่ยังไม่ได้ทำ)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
]

export default config
