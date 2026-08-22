/** รูปร่างคำตอบของ Runway เท่าที่ adapter ใช้ */
export type RunwayTask = {
  id?: string
  status?: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  output?: string[]
  failure?: string
  failureCode?: string
}
