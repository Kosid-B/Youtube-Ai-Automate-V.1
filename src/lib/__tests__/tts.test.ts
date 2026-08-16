import { describe, expect, it } from 'vitest'
import {
  MAX_REQUEST_BYTES,
  exceedsRequestLimit,
  utf8ByteLength,
  wavDurationSeconds,
} from '@/lib/tts'
import { splitIntoScenes } from '@/lib/scenes'

/**
 * สร้างไฟล์ WAV ปลอมสำหรับเทส
 * @param extraChunk แทรก chunk อื่นก่อน data เพื่อทดสอบว่าโค้ดไล่หา chunk จริงไม่ใช่เดาตำแหน่ง
 */
function makeWav({
  seconds,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
  extraChunk = false,
  dataSizeOverride,
}: {
  seconds: number
  sampleRate?: number
  channels?: number
  bitsPerSample?: number
  extraChunk?: boolean
  dataSizeOverride?: number
}): Uint8Array {
  const dataBytes = Math.round(seconds * sampleRate * channels * (bitsPerSample / 8))
  const extraSize = extraChunk ? 10 : 0
  const extraTotal = extraChunk ? 8 + extraSize + (extraSize % 2) : 0

  const total = 12 + 24 + extraTotal + 8 + dataBytes
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  const tag = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  tag(0, 'RIFF')
  view.setUint32(4, total - 8, true)
  tag(8, 'WAVE')

  tag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true)
  view.setUint16(32, channels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)

  let offset = 36
  if (extraChunk) {
    tag(offset, 'LIST')
    view.setUint32(offset + 4, extraSize, true)
    offset += 8 + extraSize + (extraSize % 2)
  }

  tag(offset, 'data')
  view.setUint32(offset + 4, dataSizeOverride ?? dataBytes, true)

  return bytes
}

describe('wavDurationSeconds', () => {
  it('อ่านความยาวถูกต้องจากไฟล์มาตรฐาน', () => {
    expect(wavDurationSeconds(makeWav({ seconds: 4.5 }))).toBe(4.5)
  })

  it('อ่านถูกแม้มี chunk อื่นแทรกก่อน data', () => {
    expect(wavDurationSeconds(makeWav({ seconds: 3, extraChunk: true }))).toBe(3)
  })

  it('รองรับ sample rate และ stereo ที่ต่างออกไป', () => {
    expect(wavDurationSeconds(makeWav({ seconds: 2, sampleRate: 48000, channels: 2 }))).toBe(2)
  })

  it('ขนาดใน data chunk ผิด (เป็น 0) ให้ยึดขนาดไฟล์จริงแทน', () => {
    expect(wavDurationSeconds(makeWav({ seconds: 5, dataSizeOverride: 0 }))).toBe(5)
  })

  it('ขนาดใน data chunk เกินไฟล์จริง ก็ยึดขนาดไฟล์จริง ไม่ใช่คืนค่าเวอร์เกินจริง', () => {
    expect(wavDurationSeconds(makeWav({ seconds: 5, dataSizeOverride: 99_999_999 }))).toBe(5)
  })

  it('ไฟล์ที่ไม่ใช่ WAV ต้อง throw ไม่ใช่คืนตัวเลขมั่ว', () => {
    expect(() => wavDurationSeconds(new Uint8Array([1, 2, 3, 4]))).toThrow(/ไม่ใช่ไฟล์ WAV/)
    expect(() => wavDurationSeconds(new Uint8Array(64))).toThrow(/ไม่ใช่ไฟล์ WAV/)
  })
})

describe('เพดานขนาดคำขอ', () => {
  it('นับเป็นไบต์ ไม่ใช่ตัวอักษร — ภาษาไทยกินตัวละ 3 ไบต์', () => {
    expect(utf8ByteLength('ก')).toBe(3)
    expect(utf8ByteLength('a')).toBe(1)
  })

  it('ฉากที่ splitIntoScenes ตัดมา ต้องไม่เกินเพดานของ Google', () => {
    const long = 'ประโยคภาษาไทยที่ยาวพอสมควรสำหรับใช้ทดสอบระบบตัดฉาก '.repeat(200)
    const scenes = splitIntoScenes(long)

    expect(scenes.length).toBeGreaterThan(10)
    for (const scene of scenes) {
      expect(exceedsRequestLimit(scene.text)).toBe(false)
    }
  })

  it('ข้อความไทยที่ยาวเกิน 1,666 ตัวอักษรถูกจับได้', () => {
    expect(exceedsRequestLimit('ก'.repeat(1666))).toBe(false)
    expect(exceedsRequestLimit('ก'.repeat(1667))).toBe(true)
    expect(utf8ByteLength('ก'.repeat(1667))).toBeGreaterThan(MAX_REQUEST_BYTES)
  })
})
