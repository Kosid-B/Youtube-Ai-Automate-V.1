/** รูปร่างคำตอบของ Gemini API เท่าที่ adapter ใช้ — ไม่ใช่สคีมาเต็มของ Google */
export type VeoOperation = {
  name?: string
  done?: boolean
  error?: { code?: number; message?: string }
  response?: {
    generatedVideos?: { video?: { uri?: string } }[]
    /** รุ่นเก่าใช้ชื่อนี้ — รับทั้งสองแบบไว้ ดีกว่าพังเพราะรุ่นใหม่ย้ายฟิลด์ */
    generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] }
  }
}

export type VeoModelList = { models?: { name?: string }[] }
