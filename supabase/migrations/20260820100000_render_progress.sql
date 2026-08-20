-- ความคืบหน้าระหว่างตัดต่อ
--
-- คลิปยาวพิเศษเรนเดอร์นานราวครึ่งชั่วโมง ตลอดเวลานั้นหน้าจอบอกได้แค่ "กำลังประกอบเสียงและภาพ"
-- ซึ่งเหมือนกันหมดตั้งแต่นาทีแรกจนนาทีสุดท้าย ผู้ใช้แยกไม่ออกว่า "กำลังทำ" กับ "ค้าง"
-- ต่างกันตรงไหน แล้วจะไปกดสั่งทำใหม่ทั้งที่ของเดิมยังเดินอยู่
--
-- worker เรนเดอร์ทีละช่วงอยู่แล้ว (ดู lib/render-chunks.ts) จึงรู้ตัวเลขนี้ตั้งแต่แรก
-- แค่ยังไม่เคยบอกใคร

alter table videos
  add column render_total smallint check (render_total > 0),
  add column render_done  smallint not null default 0 check (render_done >= 0),
  -- ต้องมีเวลาเริ่ม ไม่งั้นบอกได้แค่ "3 จาก 8" ซึ่งไม่ตอบคำถามที่คนถามจริง ๆ ว่า
  -- "อีกนานไหม" — คำนวณจากเวลาที่ใช้ไปกับช่วงที่ทำเสร็จแล้ว
  add column render_started_at timestamptz;

-- ทำเสร็จเกินจำนวนช่วงทั้งหมดไม่ได้ ถ้าเกินแปลว่าตัวนับพัง ไม่ใช่คลิปยาวเป็นพิเศษ
alter table videos
  add constraint videos_render_progress_sane
  check (render_total is null or render_done <= render_total);

comment on column videos.render_total is 'จำนวนช่วงที่ต้องเรนเดอร์ทั้งหมด (1 = ไม่ได้แบ่ง)';
comment on column videos.render_done is 'จำนวนช่วงที่เรนเดอร์เสร็จแล้ว';
comment on column videos.render_started_at is 'เวลาที่เริ่มเรนเดอร์ — ใช้ประมาณเวลาที่เหลือ';
