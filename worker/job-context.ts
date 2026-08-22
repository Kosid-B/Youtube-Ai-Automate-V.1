/**
 * บริบทที่ worker ส่งให้ handler ทุกตัว
 *
 * แยกออกมาจาก run.ts เพราะ run.ts อ่าน env ตอนถูกประเมิน และตั้งใจให้ถูกเรียก
 * ด้วย dynamic import หลัง loadEnv() เท่านั้น (ดู worker/index.ts)
 * ถ้า handler ต้อง import ชนิดข้อมูลจาก run.ts ก็ต้องพึ่ง `import type` ไม่ให้หลุด
 * เป็น import ปกติตลอดไป ซึ่งเป็นเงื่อนไขที่ไม่มีใครเห็นตอน review
 * — ย้ายมาไว้ไฟล์เปล่า ๆ แบบนี้แล้วปัญหานั้นหมดไปทั้งข้อ
 */
export type JobContext = { jobId: string }
