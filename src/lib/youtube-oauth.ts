/**
 * แลก token กับ Google สำหรับสิทธิ์อัปโหลด YouTube
 *
 * แยกเป็นโมดูลล้วน ๆ (ไม่แตะฐานข้อมูล ไม่แตะ Next) เพื่อให้เทสได้โดยไม่ต้องมี
 * ทั้งสองอย่าง — ตรรกะที่พลาดง่ายอยู่ตรงการประกอบ URL กับการอ่านคำตอบ
 * ไม่ใช่ตรงการเก็บลงฐาน
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * upload = อัปคลิป · readonly = อ่านข้อมูลช่อง · yt-analytics.readonly = ดึง CTR/AVD/RPM
 *
 * ขอ analytics ตั้งแต่ตอนเชื่อมครั้งแรกเลย ไม่งั้นตอนทำ metrics_sync
 * ต้องให้ผู้ใช้กดอนุญาตใหม่ทั้งหมดอีกรอบ
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

export type TokenSet = {
  accessToken: string
  /** มาเฉพาะครั้งแรกที่ผู้ใช้กดอนุญาต — ครั้งต่อ ๆ ไป Google ไม่ส่งมาอีก */
  refreshToken: string | null
  expiresInSeconds: number
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly googleError: string | null,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

/**
 * URL ที่พาผู้ใช้ไปหน้ากดอนุญาตของ Google
 *
 * access_type=offline + prompt=consent จำเป็นทั้งคู่:
 * - offline = ขอ refresh token ด้วย ไม่ใช่แค่ access token ที่หมดอายุใน 1 ชม.
 * - consent = บังคับให้ Google ส่ง refresh token มาใหม่ทุกครั้ง
 *   ไม่ใส่แล้วเชื่อมช่องที่สองด้วยบัญชีเดิม จะไม่ได้ refresh token กลับมาเลย
 *   แล้ว worker จะอัปโหลดไม่ได้ทั้งที่หน้าจอบอกว่าเชื่อมสำเร็จ
 */
export function buildAuthUrl(params: {
  clientId: string
  redirectUri: string
  /** ผูกคำขอกับช่อง + กัน CSRF — ต้องตรวจตอน callback กลับมา */
  state: string
}): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', params.state)
  return url.toString()
}

async function postToken(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })

  const data = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : null
    throw new OAuthError(googleErrorText(code, response.status), response.status, code)
  }

  return data
}

/** แลก code ที่ได้จาก callback เป็น token ชุดแรก */
export async function exchangeCode(
  params: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const data = await postToken(
    {
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    },
    fetchImpl,
  )

  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : null

  // ไม่มี refresh token = เชื่อมไปก็อัปอัตโนมัติไม่ได้ ต้องฟ้องตั้งแต่ตอนนี้
  // ไม่ใช่ปล่อยผ่านแล้วไปพังตอน worker หยิบงานอีกสามวันให้หลัง
  if (!refreshToken) {
    throw new OAuthError(
      'Google ไม่ได้ส่ง refresh token กลับมา — ถอนสิทธิ์แอปนี้ที่ myaccount.google.com/permissions แล้วเชื่อมใหม่',
      200,
      null,
    )
  }

  return {
    accessToken: String(data.access_token),
    refreshToken,
    expiresInSeconds: Number(data.expires_in ?? 3600),
  }
}

/** เอา refresh token มาแลก access token ใหม่ — เรียกทุกครั้งก่อนใช้งานจริง */
export async function refreshAccessToken(
  params: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const data = await postToken(
    {
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
    },
    fetchImpl,
  )

  return {
    accessToken: String(data.access_token),
    // ตอนรีเฟรช Google ไม่ส่ง refresh token กลับมา ตัวเดิมยังใช้ได้
    refreshToken: null,
    expiresInSeconds: Number(data.expires_in ?? 3600),
  }
}

/**
 * แปล error ของ Google เป็นภาษาที่บอกได้ว่าต้องทำอะไรต่อ
 *
 * โดยเฉพาะ invalid_grant ซึ่งเป็นตัวที่เจอบ่อยที่สุดและข้อความดิบไม่บอกอะไรเลย
 */
export function googleErrorText(code: string | null, status: number): string {
  switch (code) {
    case 'invalid_grant':
      return (
        'refresh token ใช้ไม่ได้แล้ว — สาเหตุที่พบบ่อยคือ OAuth consent screen ยังเป็นสถานะ ' +
        'Testing ซึ่ง Google ให้ token อายุ 7 วัน · ต้องเชื่อมช่องใหม่ หรือเปลี่ยนแอปเป็น ' +
        'Internal (ถ้าเป็น Google Workspace) เพื่อให้ token อยู่ถาวร'
      )
    case 'invalid_client':
      return 'YOUTUBE_CLIENT_ID หรือ YOUTUBE_CLIENT_SECRET ไม่ถูกต้อง'
    case 'redirect_uri_mismatch':
      return 'redirect URI ไม่ตรงกับที่ลงทะเบียนไว้ใน Google Cloud Console'
    case 'access_denied':
      return 'ผู้ใช้กดปฏิเสธสิทธิ์'
    default:
      return `แลก token กับ Google ไม่สำเร็จ (${status}${code ? ` · ${code}` : ''})`
  }
}
