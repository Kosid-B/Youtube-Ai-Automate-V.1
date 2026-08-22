-- แหล่งภาพประกอบ: ค้นจาก Pexels หรือให้ AI วาด
--
-- Pexels ให้ 200 คำค้นต่อชั่วโมง ซึ่งเป็นเพดานของ "ทั้งบัญชี" ไม่ใช่ต่อคลิป
-- ทำสองคลิปยาวพิเศษในชั่วโมงเดียวกันไม่ได้ แม้จะลดเหลือ 45 ภาพต่อคลิปแล้วก็ตาม
-- และภาพสต็อกได้แค่ "ใกล้เคียง" กับเนื้อหา ไม่ตรงกับสิ่งที่กำลังพูดถึงจริง
--
-- เก็บเป็นตัวเลือกต่อช่อง ไม่ใช่สวิตช์ทั้งระบบ เพราะสองแหล่งนี้แลกกันคนละแบบ:
-- Pexels ฟรีแต่ชนโควตา · AI เสียเงินต่อภาพแต่ไม่มีเพดานและตรงเนื้อหากว่า
-- ช่องที่ทำคลิปถี่กับช่องที่ทำนาน ๆ ครั้งจึงควรเลือกคนละอย่างได้

create type image_source as enum ('pexels', 'generated');

alter table channels
  add column image_source image_source not null default 'pexels';

comment on column channels.image_source is
  'pexels = ค้นภาพสต็อก (ฟรี ชนโควตา 200/ชม.) · generated = ให้ AI วาด (เสียเงินต่อภาพ)';

-- ── ภาพที่ AI วาดไม่มีช่างภาพและไม่มีหน้าเว็บต้นทาง ─────────────────────
--
-- สองคอลัมน์นี้ตั้ง not null ไว้ตอนที่มีแต่ Pexels ซึ่งถูกต้องตอนนั้น
-- แต่บังคับกับภาพที่วาดขึ้นไม่ได้ · ปลดเป็น null ได้ แล้วย้ายข้อบังคับ
-- ไปผูกกับ provider แทน เพื่อ "ไม่ให้หลุดข้อสัญญาที่ให้ Pexels ไว้"
-- (เราแจ้งเขาตอนขอคีย์ว่าจะให้เครดิตช่างภาพทุกคลิป — ข้อนี้ต้องยังบังคับอยู่)
alter table video_assets
  alter column photographer drop not null,
  alter column source_url  drop not null;

alter table video_assets
  add constraint video_assets_pexels_needs_credit
  check (
    provider <> 'pexels'
    or (photographer is not null and source_url is not null)
  );

comment on constraint video_assets_pexels_needs_credit on video_assets is
  'ภาพจาก Pexels ต้องมีเครดิตช่างภาพเสมอ — เป็นข้อสัญญาที่ให้ไว้ตอนขอ API key';
