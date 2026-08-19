import { describe, expect, it, vi } from 'vitest'
import {
  OAuthError,
  SCOPES,
  buildAuthUrl,
  exchangeCode,
  googleErrorText,
  refreshAccessToken,
} from '@/lib/youtube-oauth'

const CREDS = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:3000/cb' }

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('buildAuthUrl', () => {
  const url = new URL(
    buildAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:3000/cb', state: 's1' }),
  )

  /**
   * สองตัวนี้พลาดแล้วเจ็บที่สุด: ไม่มี offline = ไม่ได้ refresh token
   * ไม่มี consent = เชื่อมช่องที่สองแล้วไม่ได้ refresh token ทั้งที่จอบอกว่าสำเร็จ
   */
  it('ขอ offline access ไม่งั้นได้แค่ token อายุ 1 ชั่วโมง', () => {
    expect(url.searchParams.get('access_type')).toBe('offline')
  })

  it('บังคับ prompt=consent ไม่งั้นเชื่อมครั้งที่สองจะไม่ได้ refresh token', () => {
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('ขอสิทธิ์ analytics มาตั้งแต่แรก จะได้ไม่ต้องให้ผู้ใช้อนุญาตใหม่ตอนทำ metrics_sync', () => {
    expect(url.searchParams.get('scope')).toContain('yt-analytics.readonly')
    expect(SCOPES).toHaveLength(3)
  })

  it('ส่ง state ไปด้วยเพื่อผูกกับช่องและกัน CSRF', () => {
    expect(url.searchParams.get('state')).toBe('s1')
  })
})

describe('exchangeCode', () => {
  it('อ่าน token ครบทั้งชุด', async () => {
    const f = jsonFetch({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 })
    const set = await exchangeCode({ code: 'c', ...CREDS }, f as unknown as typeof fetch)
    expect(set).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 3599 })
  })

  /**
   * Google ตอบ 200 พร้อม access_token แต่ไม่มี refresh_token ได้
   * ถ้าปล่อยผ่าน หน้าจอจะบอกว่าเชื่อมสำเร็จ แล้วไปพังตอน worker อัปโหลดวันหลัง
   */
  it('ไม่มี refresh token ต้องฟ้องทันที ไม่ใช่ปล่อยผ่านแล้วไปพังทีหลัง', async () => {
    const f = jsonFetch({ access_token: 'at', expires_in: 3599 })
    await expect(
      exchangeCode({ code: 'c', ...CREDS }, f as unknown as typeof fetch),
    ).rejects.toThrow(/refresh token/)
  })

  it('error จาก Google ต้องมาพร้อมรหัสให้แยกแยะได้', async () => {
    const f = jsonFetch({ error: 'redirect_uri_mismatch' }, 400)
    await expect(
      exchangeCode({ code: 'c', ...CREDS }, f as unknown as typeof fetch),
    ).rejects.toMatchObject({ googleError: 'redirect_uri_mismatch' })
  })

  it('ส่งเป็น form-urlencoded ตามที่ Google ต้องการ ไม่ใช่ JSON', async () => {
    const f = jsonFetch({ access_token: 'at', refresh_token: 'rt' })
    await exchangeCode({ code: 'c', ...CREDS }, f as unknown as typeof fetch)
    const init = f.mock.calls[0][1]
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    )
    expect(String(init?.body)).toContain('grant_type=authorization_code')
  })
})

describe('refreshAccessToken', () => {
  it('คืน access token ใหม่ · refresh token เป็น null เพราะ Google ไม่ส่งมาตอนรีเฟรช', async () => {
    const f = jsonFetch({ access_token: 'new', expires_in: 3599 })
    const set = await refreshAccessToken(
      { refreshToken: 'rt', ...CREDS },
      f as unknown as typeof fetch,
    )
    expect(set.accessToken).toBe('new')
    expect(set.refreshToken).toBeNull()
  })

  it('token หมดอายุแล้วต้องโยน OAuthError พร้อมรหัส invalid_grant', async () => {
    const f = jsonFetch({ error: 'invalid_grant' }, 400)
    await expect(
      refreshAccessToken({ refreshToken: 'rt', ...CREDS }, f as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(OAuthError)
  })
})

describe('googleErrorText', () => {
  it('invalid_grant ต้องบอกสาเหตุที่พบบ่อยที่สุด ไม่ใช่แค่บอกว่าล้มเหลว', () => {
    const text = googleErrorText('invalid_grant', 400)
    expect(text).toContain('7 วัน')
    expect(text).toContain('Internal')
  })

  it('รหัสที่ไม่รู้จักยังต้องบอก status ให้ไล่ต่อได้', () => {
    expect(googleErrorText(null, 503)).toContain('503')
  })
})
