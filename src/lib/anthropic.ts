import Anthropic from '@anthropic-ai/sdk'

import { FORMATS, targetScriptChars, type VideoFormat } from '@/lib/formats'
import { salesStyleContext, type ScriptStyle } from '@/lib/sales-style'
import type { ProofPoint } from '@/lib/proof'
import { ideaContext, type IdeaBrief } from '@/lib/idea-angles'
import type { Outline } from '@/lib/outline'
import { THAI_CHARS_PER_SECOND } from '@/lib/scenes'

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
  /** รูปแบบคลิป — กำหนดความยาวสคริปต์ที่ต้องเขียน */
  format?: VideoFormat
  /** โทนการเล่าของช่อง — ไม่ระบุ = เล่าให้เข้าใจ (พฤติกรรมเดิม) */
  style?: ScriptStyle
  /**
   * หลักฐานที่ช่องนี้อ้างได้ · โทน direct ใช้ตัวเลขได้เฉพาะในรายการนี้เท่านั้น
   * รายการว่าง = ห้ามพูดตัวเลขใด ๆ (ดู lib/proof.ts)
   */
  proof?: ProofPoint[]
}

/**
 * ย่อหน้าโทนการเล่า ใช้ร่วมกันทั้ง generateScript / generateOutline / generateSection
 *
 * ต้องใส่ให้ครบทั้งสามที่ ไม่ใช่แค่ที่วางโครง — คลิปยาวเขียนทีละท่อน
 * ถ้าใส่แค่ตอนวางโครง ท่อนที่เขียนออกมาจะกลับไปเป็นโทนกลาง ๆ ทั้งหมด
 * และกฎเรื่องตัวเลขจะหายไปพร้อมกันด้วย ซึ่งเป็นข้อที่อันตรายที่สุด
 */
function styleBlock(brief: { style?: ScriptStyle; proof?: ProofPoint[] }): string | null {
  return salesStyleContext(brief.style ?? 'informative', brief.proof ?? []) || null
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

/**
 * บอกโมเดลให้ชัดว่าเขียนยาวแค่ไหน
 *
 * ไม่บอก = ได้สคริปต์ยาวเท่ากันทุกครั้ง แล้วคลิปสั้นจะกลายเป็นคลิป 8 นาที
 * ซึ่ง YouTube ไม่นับเป็น Short — เสียเหตุผลเดียวที่ทำคลิปสั้น
 */
function formatBrief(format: VideoFormat): string {
  const spec = FORMATS[format]
  const chars = targetScriptChars(format, THAI_CHARS_PER_SECOND)

  return format === 'short'
    ? [
        `รูปแบบ: คลิปสั้นแนวตั้ง ยาว ~${spec.targetSeconds} วินาที`,
        `ความยาวสคริปต์: ~${chars} ตัวอักษร (เกิน ${Math.round(chars * 1.3)} ถือว่ายาวเกินไป)`,
        'เข้าเรื่องภายในประโยคแรก ไม่มีเกริ่น ไม่มีทวนซ้ำ จบด้วยประโยคเดียวที่ให้คนอยากรู้ต่อ',
      ].join('\n')
    : [
        `รูปแบบ: คลิปยาวแนวนอน ยาว ~${Math.round(spec.targetSeconds / 60)} นาที`,
        `ความยาวสคริปต์: ~${chars} ตัวอักษร`,
      ].join('\n')
}

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
          formatBrief(brief.format ?? 'long'),
          `ช่อง: ${brief.channelName}`,
          brief.niche ? `แนวเนื้อหา: ${brief.niche}` : null,
          `หัวข้อ: ${brief.title}`,
          brief.angle ? `มุมที่อยากเล่า: ${brief.angle}` : null,
          brief.brief ? `โน้ตเพิ่มเติม: ${brief.brief}` : null,
          recent,
          styleBlock(brief) ? `\n${styleBlock(brief)}` : null,
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

const IMAGE_PROMPT_SYSTEM = `คุณเขียน prompt ภาษาอังกฤษให้โมเดลสร้างภาพ วาดภาพประกอบของคลิป

นี่ไม่ใช่คำค้นภาพสต็อก — เป็นคำสั่งวาด ต้องบรรยายให้เห็นภาพ ไม่ใช่ใส่คีย์เวิร์ด

กติกา:
- ตอบเป็นภาษาอังกฤษเท่านั้น
- หนึ่งประโยคถึงสองประโยค บรรยายสิ่งที่อยู่ในภาพ มุมกล้อง และแสง
- ⚠️ ห้ามมีตัวหนังสือ ตัวเลข ป้าย หน้าจอที่อ่านออก หรือกราฟที่มีตัวอักษรในภาพเด็ดขาด
  โมเดลสร้างภาพเขียนอักษรไทยไม่ได้ ออกมาเป็นอักษรมั่วซึ่งเห็นชัดมากว่าเป็นภาพ AI
  ต้องสั่งไว้ใน prompt ทุกใบว่า no text, no letters, no numbers, no signage
- ห้ามใส่ใบหน้าที่เห็นชัด ชื่อแบรนด์ โลโก้ หรือคนที่ระบุตัวได้
  (ใช้มุมหลัง มุมมือ หรือระยะไกลแทน)
- ต้องเป็นสิ่งที่ "เห็นได้" ไม่ใช่แนวคิด
  ฉากพูดถึงร้านกาแฟเจ๊ง → ร้านว่างเปล่าเก้าอี้คว่ำบนโต๊ะ ไม่ใช่ "ความล้มเหลว"
- ทุกใบในคลิปเดียวกันต้องดูเป็นชุดเดียวกัน — ใส่คำบรรยายสไตล์เดียวกันซ้ำทุกใบ
  (โทนสี ชนิดแสง ระยะภาพ) ไม่งั้นคลิปจะดูเหมือนเอาภาพคนละที่มาแปะกัน
- ห้ามให้สองใบในคลิปเดียวกันเป็นภาพเดียวกัน คนดูจะรู้สึกว่าวนภาพเดิม`

export type SceneImageQuery = { sceneIndex: number; query: string }

/**
 * เขียน prompt วาดภาพให้แต่ละช็อต
 *
 * แยกจาก sceneImageQueries() เพราะเป็นงานคนละอย่าง — อันนั้นได้ "คีย์เวิร์ดไปค้น"
 * อันนี้ได้ "คำสั่งวาด" · เอา prompt ค้นสต็อกไปสั่งวาดจะได้ภาพแบนที่ไม่มีองค์ประกอบ
 *
 * เรียกครั้งเดียวได้ทุกช็อต เพื่อให้โมเดลเห็นภาพอื่นที่ตัวเองสั่งไปแล้ว
 * จะได้คุมให้เป็นชุดเดียวกันและไม่ซ้ำกันเอง — เรียกทีละใบทำสองอย่างนี้ไม่ได้เลย
 */
export async function shotImagePrompts(
  shots: readonly { index: number; text: string }[],
  context: { title: string; niche?: string | null },
): Promise<SceneImageQuery[]> {
  if (shots.length === 0) return []

  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: IMAGE_QUERY_SCHEMA },
    },
    system: IMAGE_PROMPT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `หัวข้อคลิป: ${context.title}`,
          context.niche ? `แนวเนื้อหา: ${context.niche}` : null,
          '',
          'แต่ละช็อต (ภาพหนึ่งใบต่อหนึ่งช็อต ต้องอยู่ได้ตลอดช็อต):',
          ...shots.map((shot) => `[${shot.index}] ${shot.text}`),
        ]
          .filter((line) => line !== null)
          .join('\n'),
      },
    ],
  })

  const block = response.content.find((part) => part.type === 'text')
  if (!block || block.type !== 'text') throw new Error('โมเดลไม่ได้ตอบเป็นข้อความ')

  const parsed = JSON.parse(block.text) as { queries: { scene_index: number; query: string }[] }
  return parsed.queries.map((item) => ({ sceneIndex: item.scene_index, query: item.query }))
}

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

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          angle: { type: 'string' },
          hook: { type: 'string' },
          segment: { type: 'string' },
          /** 0–1 ความมั่นใจว่ามีคนอยากรู้เรื่องนี้จริง */
          demand: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['title', 'angle', 'hook', 'segment', 'demand', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
} as const

const IDEA_SYSTEM = `คุณคิดหัวข้อคลิป YouTube ภาษาไทยให้ช่องธุรกิจ

หน้าที่ของคุณคือเสนอหัวข้อที่ "มีคนอยากรู้จริง" ไม่ใช่หัวข้อที่ฟังดูดี

เกณฑ์ของหัวข้อที่ใช้ได้:
- เป็นปัญหาที่คนกลุ่มเป้าหมายเจอจริงและยังไม่มีใครตอบให้ชัด
- คนที่เจอปัญหานี้จะพิมพ์ค้นด้วยคำแบบไหน หัวข้อควรมีคำนั้นอยู่
- เนื้อหาในคลิปต้องตอบสิ่งที่หัวข้อสัญญาได้จริงภายในความยาวที่ทำได้

ช่อง demand ให้ประเมินตรง ๆ 0–1 ว่ามีคนอยากรู้เรื่องนี้แค่ไหน
ถ้าไม่มั่นใจให้ใส่ต่ำ อย่าให้คะแนนสูงทุกหัวข้อเพราะจะไม่ช่วยคัดอะไรเลย

ช่อง reason ให้บอกเหตุผลสั้น ๆ ว่าทำไมคิดว่าคนอยากรู้ — ถ้าเขียนเหตุผลไม่ออก
แปลว่าหัวข้อนั้นยังไม่ดีพอ`

export type GeneratedIdea = {
  title: string
  angle: string
  hook: string
  segment: string
  demand: number
  reason: string
}

/**
 * คิดหัวข้อคลิปจากข้อมูลกลุ่มเป้าหมายจริง
 *
 * เรียกครั้งเดียวได้หลายหัวข้อ เพื่อให้โมเดลเห็นหัวข้ออื่นที่ตัวเองเสนอไปแล้ว
 * แล้วเลี่ยงการเสนอเรื่องเดียวกันในมุมต่างกันเล็กน้อย — เรียกทีละหัวข้อจะได้ของซ้ำ
 */
export async function generateIdeas(brief: IdeaBrief): Promise<GeneratedIdea[]> {
  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      // คิดหัวข้อไม่ต้องใช้ความพยายามเท่าเขียนสคริปต์ทั้งเรื่อง
      effort: 'medium',
      format: { type: 'json_schema', schema: IDEA_SCHEMA },
    },
    system: IDEA_SYSTEM,
    messages: [{ role: 'user', content: ideaContext(brief) }],
  })

  const block = response.content.find((part) => part.type === 'text')
  if (!block || block.type !== 'text') throw new Error('โมเดลไม่ได้ตอบเป็นข้อความ')

  const parsed = JSON.parse(block.text) as { ideas: GeneratedIdea[] }
  return parsed.ideas
}

const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    promise: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, covers: { type: 'string' } },
        required: ['heading', 'covers'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'promise', 'sections'],
  additionalProperties: false,
} as const

const OUTLINE_SYSTEM = `คุณวางโครงคลิป YouTube ยาวภาษาไทยสำหรับช่องธุรกิจ

แบ่งเป็นท่อนที่ "จบในตัวเอง" — คนที่กระโดดมาดูกลางท่อนต้องยังเข้าใจได้
แต่ละท่อนต้องตอบคนละคำถาม ห้ามเล่าเรื่องเดียวกันซ้ำในมุมต่างกันนิดเดียว

promise คือสิ่งที่คนดูจะทำได้หลังดูจบ ต้องเป็นสิ่งที่จับต้องได้
"เข้าใจเรื่องต้นทุนมากขึ้น" ใช้ไม่ได้ · "คำนวณต้นทุนจริงของสินค้าตัวเองได้" ใช้ได้

เรียงท่อนตามลำดับที่คนต้องรู้จริง ๆ ไม่ใช่ตามที่ฟังดูเป็นระบบ`

/** วางโครงคลิปยาวก่อนเขียน — ตรวจโครงถูกกว่าเขียนเสร็จแล้วพบว่าโครงพัง */
export async function generateOutline(
  brief: ScriptBrief & { sectionCount: number },
): Promise<Outline> {
  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTLINE_SCHEMA } },
    system: OUTLINE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `ช่อง: ${brief.channelName}`,
          brief.niche ? `แนวเนื้อหา: ${brief.niche}` : null,
          `หัวข้อ: ${brief.title}`,
          brief.angle ? `มุมที่อยากเล่า: ${brief.angle}` : null,
          `แบ่งเป็น ${brief.sectionCount} ท่อน`,
          styleBlock(brief) ? `\n${styleBlock(brief)}` : null,
          brief.recentTitles.length > 0
            ? `เคยทำไปแล้ว (ห้ามซ้ำ):\n${brief.recentTitles.map((t) => `- ${t}`).join('\n')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  })

  const block = response.content.find((part) => part.type === 'text')
  if (!block || block.type !== 'text') throw new Error('โมเดลไม่ได้ตอบเป็นข้อความ')

  return JSON.parse(block.text) as Outline
}

const SECTION_SYSTEM = `คุณเขียนบทพูดหนึ่งท่อนของคลิป YouTube ยาวภาษาไทย

เขียนเฉพาะบทพูดของท่อนนี้ ไม่ต้องเกริ่นว่ากำลังจะเข้าท่อนอะไร
ไม่ต้องทวนสิ่งที่ท่อนก่อนหน้าเล่าไปแล้ว และไม่ต้องสรุปตอนจบท่อน
เพราะคนดูฟังต่อเนื่อง การทวนทุกท่อนทำให้คลิปยาวเกินจำเป็นและน่าเบื่อ

เขียนต่อจากประโยคสุดท้ายของท่อนก่อนหน้าให้ลื่น เหมือนคนเดียวกันพูดต่อ`

/**
 * เขียนทีละท่อน
 *
 * ให้ดูโครงทั้งหมดแต่เขียนแค่ท่อนเดียว โมเดลจะได้รู้ว่าอะไรอยู่ท่อนอื่นแล้ว
 * ไม่ต้องเล่าซ้ำ — จุดนี้คือเหตุผลหลักที่แบ่งท่อนแล้วได้ผลดีกว่าเขียนรวดเดียว
 */
export async function generateSection(input: {
  outline: Outline
  index: number
  channelName: string
  niche: string | null
  targetChars: number
  /** ท้ายท่อนก่อนหน้า ~300 ตัวอักษร ใช้ต่อประโยคให้ลื่น */
  previousTail: string | null
  style?: ScriptStyle
  proof?: ProofPoint[]
}): Promise<string> {
  const section = input.outline.sections[input.index]

  const response = await anthropic().messages.create({
    model: SCRIPT_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: SECTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `ช่อง: ${input.channelName}`,
          input.niche ? `แนวเนื้อหา: ${input.niche}` : null,
          `คลิปเรื่อง: ${input.outline.title}`,
          `ดูจบแล้วต้องทำได้: ${input.outline.promise}`,
          styleBlock(input) ? `\n${styleBlock(input)}\n` : null,
          '',
          'โครงทั้งคลิป:',
          ...input.outline.sections.map(
            (s, i) => `${i + 1}. ${s.heading} — ${s.covers}${i === input.index ? '  ← เขียนท่อนนี้' : ''}`,
          ),
          '',
          `ความยาวท่อนนี้: ~${input.targetChars} ตัวอักษร`,
          input.previousTail
            ? `\nท้ายท่อนก่อนหน้า (เขียนต่อให้ลื่น):\n"...${input.previousTail}"`
            : '\nนี่คือท่อนแรก — เปิดเรื่องด้วยประเด็นที่คนดูสนใจภายในสองประโยคแรก',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  })

  const block = response.content.find((part) => part.type === 'text')
  if (!block || block.type !== 'text') throw new Error('โมเดลไม่ได้ตอบเป็นข้อความ')

  if (!section) throw new Error(`ไม่มีท่อนที่ ${input.index} ในโครง`)

  return block.text.trim()
}
