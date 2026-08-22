/**
 * ชั้นกลางของโมเดลภาษา — เรียกได้ทั้ง Anthropic และ OpenAI ด้วยโค้ดชุดเดียว
 *
 * ทำไมต้องมีชั้นนี้ ไม่เรียก SDK ตรง ๆ: prompt ทั้งหมดในโปรเจคเขียนมาสำหรับ
 * รูปแบบเดียว (system + user + JSON schema + ระดับความพยายาม) แต่สองเจ้านี้
 * ตั้งชื่อพารามิเตอร์คนละอย่างหมด กระจายการแปลงไว้ทั้ง 6 จุดที่เรียกโมเดล
 * แปลว่าเพิ่มเจ้าที่สามต้องแก้ 6 ที่ และแก้ตกไปหนึ่งที่จะไม่มีอะไรฟ้อง
 *
 * ตารางแปลง:
 *   effort          → Anthropic output_config.effort · OpenAI reasoning_effort
 *   schema          → Anthropic output_config.format · OpenAI response_format.json_schema
 *   maxTokens       → Anthropic max_tokens          · OpenAI max_completion_tokens
 */
import Anthropic from '@anthropic-ai/sdk'

/** โมเดลที่ใช้เขียนสคริปต์ฝั่ง Anthropic */
export const SCRIPT_MODEL = 'claude-opus-5'

/**
 * ฝั่ง OpenAI ต้องตั้งเอง ไม่มีค่าเริ่มต้นที่ปลอดภัย
 *
 * ชื่อรุ่นของ OpenAI เปลี่ยนบ่อยและต่างกันตามสิ่งที่บัญชีนั้นเปิดใช้ได้
 * เดาไว้ในโค้ดแล้วผิดจะได้ 404 ที่ไม่บอกว่าให้ไปแก้ตรงไหน
 * ดูรายชื่อที่บัญชีคุณเรียกได้จริงด้วย: pnpm preflight
 */
export const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? 'gpt-5.6-terra'

export type Provider = 'anthropic' | 'openai'

/** ตั้งที่ระดับ env เพราะเป็นการตัดสินใจของทั้งระบบ ไม่ใช่ของช่องใดช่องหนึ่ง */
export function provider(): Provider {
  return process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'anthropic'
}

export type CompleteInput = {
  system: string
  user: string
  maxTokens: number
  /** ความพยายามในการคิดก่อนตอบ — งานวางโครง/เขียนบทใช้ high · งานแปลงข้อความใช้ low */
  effort: 'low' | 'medium' | 'high'
  /** ใส่ = บังคับให้ตอบเป็น JSON ตามสคีมานี้ */
  schema?: Record<string, unknown>
  /** ชื่อสคีมา — OpenAI บังคับต้องมี ส่วน Anthropic ไม่ใช้ */
  schemaName?: string
}

let anthropicClient: Anthropic | null = null

export function anthropic(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ไม่ได้ตั้ง ANTHROPIC_API_KEY')
    anthropicClient = new Anthropic()
  }
  return anthropicClient
}

/** ขอคำตอบจากโมเดล คืนเป็นข้อความดิบ (ผู้เรียกเป็นคน JSON.parse เอง) */
export async function complete(input: CompleteInput): Promise<string> {
  return provider() === 'openai' ? completeOpenAi(input) : completeAnthropic(input)
}

async function completeAnthropic(input: CompleteInput): Promise<string> {
  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: input.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: input.effort,
      ...(input.schema ? { format: { type: 'json_schema', schema: input.schema } } : {}),
    },
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('โมเดลปฏิเสธคำขอนี้ ลองปรับหัวข้อหรือโน้ตเพิ่มเติม')
  }

  const text = response.content.find((block) => block.type === 'text')?.text
  if (!text) throw new Error('โมเดลไม่ได้ส่งเนื้อหากลับมา')

  return text
}

async function completeOpenAi(input: CompleteInput): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('ไม่ได้ตั้ง OPENAI_API_KEY (LLM_PROVIDER=openai)')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      max_completion_tokens: input.maxTokens,
      reasoning_effort: input.effort,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      ...(input.schema
        ? {
            response_format: {
              type: 'json_schema',
              // strict บังคับให้ตอบตรงสคีมาเป๊ะ ไม่ใช่ "พยายามตาม" — สคีมาของเรา
              // ตั้ง additionalProperties: false ไว้ครบทุกชั้นอยู่แล้วจึงใช้ได้ทันที
              json_schema: {
                name: input.schemaName ?? 'result',
                schema: input.schema,
                strict: true,
              },
            },
          }
        : {}),
    }),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)

    /**
     * 404 กับข้อความว่าไม่รู้จักโมเดล = ชื่อรุ่นผิดหรือบัญชียังไม่เปิดให้ใช้
     * error ดิบของ OpenAI ไม่ได้บอกว่าให้ไปแก้ตรงไหน จึงต้องบอกเอง
     */
    if (response.status === 404 || detail.includes('does not exist')) {
      throw new Error(
        `บัญชีนี้เรียกโมเดล "${OPENAI_TEXT_MODEL}" ไม่ได้ — ตั้ง OPENAI_TEXT_MODEL ` +
          'ให้ตรงกับที่บัญชีมี (ดูรายชื่อด้วย pnpm preflight)',
      )
    }

    throw new Error(`เรียกโมเดลไม่สำเร็จ (${response.status}): ${detail}`)
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[]
  }

  const choice = body.choices?.[0]?.message

  if (choice?.refusal) {
    throw new Error('โมเดลปฏิเสธคำขอนี้ ลองปรับหัวข้อหรือโน้ตเพิ่มเติม')
  }

  if (!choice?.content) throw new Error('โมเดลไม่ได้ส่งเนื้อหากลับมา')

  return choice.content
}
