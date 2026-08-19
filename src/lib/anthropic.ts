import Anthropic from '@anthropic-ai/sdk'

/** โมเดลที่ใช้เขียนสคริปต์ */
export const SCRIPT_MODEL = 'claude-opus-5'

let cached: Anthropic | null = null

export function anthropic(): Anthropic {
  if (!cached) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ไม่ได้ตั้ง ANTHROPIC_API_KEY')
    }
    cached = new Anthropic()
  }
  return cached
}

export interface ScriptBrief {
  /** ชื่อช่องและแนวเนื้อหา ใช้กำหนดน้ำเสียง */
  channelName: string
  niche: string | null
  /** หัวข้อ/ไอเดียที่จะทำ */
  title: string
  angle: string | null
  /** หัวข้อที่ช่องเคยทำไปแล้ว — บอกโมเดลให้เลี่ยงการเล่าซ้ำ */
  recentTitles: string[]
  /** โน้ตเพิ่มเติมจากผู้ใช้ */
  brief?: string
  /**
   * สิ่งที่เรียนรู้จากคลิปที่วัดผลแล้วของช่องนี้ (จาก lib/content-feedback)
   * null = ข้อมูลยังไม่พอ ห้ามใส่อะไรเข้า prompt เลย ปล่อยให้โมเดลตัดสินเอง
   */
  performanceNote?: string | null
}

export interface GeneratedScript {
  title: string
  body: string
  /** มุมมองเฉพาะของคลิปนี้ ใช้ประกอบ checklist ความเป็นต้นฉบับ */
  angle: string
  /** ข้อมูล/ตัวเลขที่อ้างในสคริปต์ พร้อมที่มา ให้คนตรวจได้ */
  sources: string[]
}

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    angle: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'body', 'angle', 'sources'],
  additionalProperties: false,
} as const

const SYSTEM = `คุณเขียนสคริปต์คลิป YouTube ภาษาไทยให้ช่องที่เจ้าของไม่ออกกล้อง

เขียนเป็นบทพูดต่อเนื่องที่อ่านออกเสียงได้ทันที ไม่ใส่หัวข้อย่อย ไม่ใส่คำสั่งกำกับกล้อง
เปิดเรื่องด้วยประเด็นที่คนดูสนใจภายในสองประโยคแรก ไม่ทักทายยืดยาว

ข้อห้ามที่สำคัญที่สุด — ช่องจะโดนตัดรายได้ถ้าทำผิด:
- ห้ามเรียบเรียงเนื้อหาจากคลิปหรือบทความอื่นแบบเปลี่ยนคำ ต้องมีมุมมองของช่องเอง
- ห้ามแต่งตัวเลข สถิติ ชื่อคน หรือเหตุการณ์ ถ้าไม่แน่ใจให้เขียนแบบไม่อ้างตัวเลข
- ตัวเลขทุกตัวที่อ้างในสคริปต์ ต้องระบุที่มาไว้ใน sources ให้คนตรวจได้

sources = รายการที่มาของข้อมูลที่อ้าง ถ้าสคริปต์ไม่ได้อ้างข้อมูลภายนอกเลย ให้ส่งเป็นลิสต์ว่าง`

export async function generateScript(brief: ScriptBrief): Promise<GeneratedScript> {
  const recent = brief.recentTitles.length
    ? `\n\nคลิปที่ช่องนี้ทำไปแล้ว (ห้ามเล่าซ้ำ ต้องหามุมใหม่):\n${brief.recentTitles
        .map((t) => `- ${t}`)
        .join('\n')}`
    : ''

  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: SCRIPT_SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `ช่อง: ${brief.channelName}`,
          brief.niche ? `แนวเนื้อหา: ${brief.niche}` : null,
          `หัวข้อ: ${brief.title}`,
          brief.angle ? `มุมที่อยากเล่า: ${brief.angle}` : null,
          brief.brief ? `โน้ตเพิ่มเติม: ${brief.brief}` : null,
          recent,
          // ท้ายสุดเพราะเป็นแนวทาง ไม่ใช่โจทย์ — หัวข้อกับมุมที่ผู้ใช้สั่งต้องมาก่อน
          brief.performanceNote ? `\n\nสิ่งที่ช่องนี้เรียนรู้มา:\n${brief.performanceNote}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('โมเดลปฏิเสธคำขอนี้ ลองปรับหัวข้อหรือโน้ตเพิ่มเติม')
  }

  const text = response.content.find((block) => block.type === 'text')?.text
  if (!text) {
    throw new Error('โมเดลไม่ได้ส่งเนื้อหากลับมา')
  }

  return JSON.parse(text) as GeneratedScript
}

const IMAGE_QUERY_SCHEMA = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene_index: { type: 'integer' },
          query: { type: 'string' },
        },
        required: ['scene_index', 'query'],
        additionalProperties: false,
      },
    },
  },
  required: ['queries'],
  additionalProperties: false,
} as const

const IMAGE_QUERY_SYSTEM = `คุณแปลงเนื้อหาแต่ละฉากของคลิปเป็นคำค้นภาพสต็อกภาษาอังกฤษ

กติกา:
- ตอบเป็นภาษาอังกฤษเท่านั้น เพราะคลังภาพสต็อกค้นภาษาไทยไม่เจอ
- 2-4 คำต่อฉาก เป็นคำที่บรรยาย "ภาพที่ควรเห็น" ไม่ใช่สรุปเนื้อหา
  เช่นฉากพูดถึงร้านกาแฟเจ๊ง → "empty coffee shop" ไม่ใช่ "business failure"
- เลือกสิ่งที่ถ่ายเป็นภาพได้จริง หลีกเลี่ยงแนวคิดนามธรรม
  ("teamwork meeting" ใช้ได้ · "success mindset" ใช้ไม่ได้)
- อย่าใช้คำค้นซ้ำกันสองฉาก คลิปจะดูเหมือนวนภาพเดิม
- ห้ามใส่ชื่อแบรนด์ ชื่อคนจริง หรือโลโก้`

export type SceneImageQuery = { sceneIndex: number; query: string }

/**
 * หาคำค้นภาพภาษาอังกฤษให้ทุกฉากในคำขอเดียว
 *
 * เรียกรวมทีเดียวไม่ใช่ฉากละครั้ง เพราะโมเดลต้องเห็นทุกฉากพร้อมกัน
 * ถึงจะเลี่ยงการให้คำค้นซ้ำกันได้ และประหยัดกว่ามาก
 */
export async function sceneImageQueries(
  scenes: readonly { index: number; text: string }[],
  context: { title: string; niche?: string | null },
): Promise<SceneImageQuery[]> {
  if (scenes.length === 0) return []

  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: IMAGE_QUERY_SCHEMA },
    },
    system: IMAGE_QUERY_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `หัวข้อคลิป: ${context.title}`,
          context.niche ? `แนวเนื้อหา: ${context.niche}` : null,
          '',
          'ฉาก:',
          ...scenes.map((scene) => `[${scene.index}] ${scene.text}`),
        ]
          .filter((line) => line !== null)
          .join('\n'),
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('โมเดลปฏิเสธคำขอหาคำค้นภาพ')
  }

  const text = response.content.find((block) => block.type === 'text')?.text
  if (!text) throw new Error('โมเดลไม่ได้ส่งคำค้นภาพกลับมา')

  const parsed = JSON.parse(text) as { queries: { scene_index: number; query: string }[] }
  const byIndex = new Map(parsed.queries.map((q) => [q.scene_index, q.query.trim()]))

  // ฉากที่โมเดลข้ามไปต้องมีคำค้นสำรอง ไม่งั้นฉากนั้นไม่มีภาพแล้ว render ไม่ได้
  return scenes.map((scene) => ({
    sceneIndex: scene.index,
    query: byIndex.get(scene.index) || fallbackQuery(context),
  }))
}

/** คำค้นสำรองกลาง ๆ ที่ยังเข้ากับคลิปสายธุรกิจ ใช้เมื่อโมเดลไม่ได้ให้คำค้นของฉากนั้นมา */
function fallbackQuery(context: { niche?: string | null }): string {
  return context.niche?.trim() ? 'business workplace' : 'abstract background'
}
