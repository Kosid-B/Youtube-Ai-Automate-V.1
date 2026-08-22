import { afterEach, describe, expect, it, vi } from 'vitest'
import { complete, provider } from '@/lib/llm'

const SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
} as const

afterEach(() => {
  delete process.env.LLM_PROVIDER
  delete process.env.OPENAI_TEXT_MODEL
  vi.unstubAllGlobals()
})

function stubOpenAi(response: Record<string, unknown>, init: Partial<Response> = {}) {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(response),
    json: async () => response,
    ...init,
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('provider', () => {
  /** ค่าเริ่มต้นต้องเป็น Anthropic — เปลี่ยนผู้ให้บริการต้องเป็นการตัดสินใจที่ตั้งใจ */
  it('ไม่ตั้งอะไรเลยต้องได้ anthropic', () => {
    expect(provider()).toBe('anthropic')
  })

  it('ตั้ง LLM_PROVIDER=openai ถึงจะเปลี่ยน', () => {
    process.env.LLM_PROVIDER = 'openai'
    expect(provider()).toBe('openai')
  })

  it('ค่าที่ไม่รู้จักต้องตกกลับไปที่ anthropic ไม่ใช่พังหรือเงียบ ๆ ไปใช้ค่าแปลก', () => {
    process.env.LLM_PROVIDER = 'gemini'
    expect(provider()).toBe('anthropic')
  })
})

describe('complete → OpenAI', () => {
  /**
   * ตารางแปลงพารามิเตอร์คือหัวใจของชั้นนี้ — แปลผิดหนึ่งช่องแล้วจะไม่มีอะไรฟ้อง
   * แค่ได้คำตอบที่คุณภาพต่างจากที่ตั้งใจ ซึ่งมองไม่เห็นจนกว่าจะอ่านสคริปต์ที่ได้
   */
  it('แปลง effort/maxTokens/schema เป็นชื่อพารามิเตอร์ของ OpenAI ให้ถูก', async () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test'
    const mock = stubOpenAi({ choices: [{ message: { content: '{"answer":"ok"}' } }] })

    await complete({
      system: 'ระบบ',
      user: 'ผู้ใช้',
      maxTokens: 1234,
      effort: 'high',
      schema: SCHEMA,
      schemaName: 'thing',
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.max_completion_tokens).toBe(1234)
    expect(body.reasoning_effort).toBe('high')
    expect(body.messages).toEqual([
      { role: 'system', content: 'ระบบ' },
      { role: 'user', content: 'ผู้ใช้' },
    ])
    // strict = ต้องตอบตรงสคีมาเป๊ะ ไม่ใช่ "พยายามตาม"
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.name).toBe('thing')
  })

  it('ไม่มีสคีมาต้องไม่ส่ง response_format ไปเลย', async () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test'
    const mock = stubOpenAi({ choices: [{ message: { content: 'ข้อความเปล่า' } }] })

    const text = await complete({ system: 'a', user: 'b', maxTokens: 10, effort: 'low' })

    expect(text).toBe('ข้อความเปล่า')
    expect(JSON.parse(mock.mock.calls[0][1].body as string).response_format).toBeUndefined()
  })

  /**
   * ชื่อรุ่นของ OpenAI เปลี่ยนบ่อยและต่างกันตามสิ่งที่บัญชีเปิดใช้ได้
   * error ดิบเป็น 404 ที่ไม่บอกว่าให้ไปแก้ตรงไหน จึงต้องบอกเอง
   */
  it('เรียกโมเดลที่บัญชีไม่มี ต้องบอกให้ไปตั้ง OPENAI_TEXT_MODEL', async () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test'
    stubOpenAi({}, { ok: false, status: 404, text: async () => 'model does not exist' })

    await expect(
      complete({ system: 'a', user: 'b', maxTokens: 10, effort: 'low' }),
    ).rejects.toThrow(/OPENAI_TEXT_MODEL/)
  })

  it('โมเดลปฏิเสธ ต้องได้ข้อความเดียวกับฝั่ง Anthropic ไม่ใช่ error ดิบ', async () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test'
    stubOpenAi({ choices: [{ message: { refusal: 'no' } }] })

    await expect(
      complete({ system: 'a', user: 'b', maxTokens: 10, effort: 'low' }),
    ).rejects.toThrow(/ปฏิเสธ/)
  })

  it('ไม่ได้ตั้งคีย์ต้องบอกว่าต้องตั้งตัวไหน', async () => {
    process.env.LLM_PROVIDER = 'openai'
    delete process.env.OPENAI_API_KEY

    await expect(
      complete({ system: 'a', user: 'b', maxTokens: 10, effort: 'low' }),
    ).rejects.toThrow(/OPENAI_API_KEY/)
  })
})
