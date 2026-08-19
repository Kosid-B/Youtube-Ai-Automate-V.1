import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'

/**
 * ต่ออายุ session ให้ Server Component อ่านผู้ใช้ได้
 * Server Component เขียน cookie ไม่ได้ การ refresh จึงต้องทำที่นี่
 *
 * ⚠️ ทั้งฟังก์ชันห่อ try/catch ไว้โดยตั้งใจ
 *
 * middleware ทำงานกับ "ทุก request" ที่เข้าเว็บ ถ้ามันโยน error ออกมา Vercel ตอบ
 * MIDDLEWARE_INVOCATION_FAILED เป็น 500 ทุกหน้า รวมถึงหน้า login — เว็บดับทั้งใบ
 * จากงานที่เป็นแค่ "งานเสริม"
 *
 * การต่ออายุ session ล้มเหลว ผลที่ควรเกิดคือผู้ใช้หลุดล็อกอินแล้วเข้าใหม่
 * ไม่ใช่ทุกคนเปิดเว็บไม่ได้ · เคยเกิดจริงตอน deploy ครั้งแรก
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!url || !key) return NextResponse.next()

  // URL ที่พิมพ์ผิดหรือมีช่องว่างติดมาทำให้ createServerClient โยน 'Invalid URL'
  // ตรวจก่อนดีกว่าปล่อยให้ throw แล้วเดาสาเหตุจาก log ทีหลัง
  if (!URL.canParse(url)) {
    console.error(`[middleware] NEXT_PUBLIC_SUPABASE_URL ไม่ใช่ URL ที่ถูกต้อง: ${url}`)
    return NextResponse.next()
  }

  const response = NextResponse.next({ request })

  try {
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    })

    await supabase.auth.getUser()
  } catch (error) {
    // เน็ตไปไม่ถึง Supabase, คีย์ผิด, หรือ Supabase ล่ม — ปล่อยผ่านไปแบบไม่มี session
    console.error('[middleware] ต่ออายุ session ไม่สำเร็จ ปล่อยผ่านแบบไม่ล็อกอิน:', error)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
