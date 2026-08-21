-- โทนการเขียนของช่อง + หลักฐานที่ช่องนั้นอ้างได้
--
-- สไตล์ direct-response เดินด้วย "ตัวเลขที่เจาะจง" เป็นหลัก แต่กติกาของโปรเจคนี้เอง
-- ห้ามใส่ตัวเลขที่ยังไม่ได้ตรวจแหล่งที่มา สองอย่างนี้ขัดกันตรง ๆ ถ้าไม่มีที่เก็บ
--
-- ทางออก: เปลี่ยนคำสั่งที่ให้โมเดลจาก "ห้ามใช้ตัวเลข" เป็น "ใช้ได้เฉพาะในรายการนี้"
-- เจ้าของช่องเป็นคนใส่ และใส่พร้อมที่มาเสมอ เพื่อให้ตอบได้เมื่อมีคนถามว่าเอามาจากไหน
-- ไม่มีหลักฐานสักข้อ = เขียนคลิปได้ แต่ห้ามมีตัวเลขในบทพูด ซึ่งถูกแล้ว —
-- ช่องที่ยังไม่มีผลงานไม่ควรพูดเหมือนมี

create type script_style as enum ('informative', 'direct');

/*
 * ตรวจรูปร่างของ proof_points ที่ระดับฐานข้อมูล
 *
 * แยกเป็นฟังก์ชันเพราะ CHECK constraint มี subquery ไม่ได้ (jsonb_array_elements
 * ต้องอยู่ใน FROM) และตรวจฝั่งแอปอย่างเดียวไม่พอ — worker เขียนด้วย service role
 * ซึ่งข้าม RLS และไม่ผ่าน validation ของฟอร์ม
 */
create function proof_points_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 6
     and not exists (
       select 1
       from jsonb_array_elements(p) as e
       where jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e -> 'claim') is distinct from 'string'
          or jsonb_typeof(e -> 'source') is distinct from 'string'
          or length(btrim(e ->> 'claim')) = 0
          or length(e ->> 'claim') > 80
          -- ที่มาว่าง = ข้อนั้นใช้ไม่ได้ ไม่ใช่ "ใส่ทีหลังได้" · ทั้งระบบนี้มีอยู่
          -- เพื่อบังคับให้ตัวเลขมีที่มา ยอมให้เว้นว่างเมื่อไรก็เท่ากับไม่มีระบบนี้
          or length(btrim(e ->> 'source')) = 0
          or length(e ->> 'source') > 200
     );
$$;

alter table channels
  add column script_style script_style not null default 'direct',
  add column proof_points jsonb not null default '[]'::jsonb
    constraint channels_proof_points_shape check (proof_points_ok(proof_points));

comment on column channels.script_style is
  'informative = เล่าให้เข้าใจ · direct = ชวนให้ลงมือ (ต้องมี proof_points ถึงจะพูดตัวเลขได้)';
comment on column channels.proof_points is
  'หลักฐานที่ช่องนี้อ้างได้ [{claim, source}] — โมเดลใช้ตัวเลขได้เฉพาะในรายการนี้';
