-- ภาพที่ใช้ในแต่ละคลิป + เครดิตช่างภาพ
--
-- ต้องเก็บเครดิตเพราะเราแจ้ง Pexels ไว้ตอนขอ API key ว่าจะให้เครดิตช่างภาพ
-- ในคำอธิบายใต้คลิปทุกคลิป ถ้าไม่เก็บตั้งแต่ตอนดาวน์โหลด ตอนอัปก็ประกอบเครดิตไม่ได้
-- (Pexels ไม่ได้บังคับเครดิต แต่บังคับถ้าจะขอโควตาไม่จำกัด และเราแจ้งเขาไปแล้วว่าจะทำ)

create table video_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  video_id uuid not null references videos (id) on delete cascade,
  /** ฉากที่เท่าไรในคลิป เริ่มจาก 0 */
  scene_index integer not null check (scene_index >= 0),

  provider text not null default 'pexels',
  /** id ของภาพฝั่งผู้ให้บริการ ใช้กันดาวน์โหลดซ้ำและตามกลับไปหาต้นทางได้ */
  provider_id text not null,

  photographer text not null,
  photographer_url text,
  /** ลิงก์หน้าภาพบนเว็บผู้ให้บริการ — ต้องใส่ในเครดิต */
  source_url text not null,

  /** พาธไฟล์ที่ดาวน์โหลดมาเก็บไว้ระหว่างประกอบคลิป */
  storage_path text,
  /** คำค้นที่ใช้หาภาพนี้ เก็บไว้ปรับปรุงคุณภาพการค้นทีหลัง */
  query text,

  created_at timestamptz not null default now(),

  -- หนึ่งฉากใช้ภาพเดียว · ทำให้ handler รันซ้ำได้โดยไม่เกิดภาพซ้อน
  unique (video_id, scene_index)
);

create index video_assets_video_idx on video_assets (video_id, scene_index);

alter table video_assets enable row level security;

-- ผู้ใช้ในองค์กรดูได้ว่าคลิปตัวเองใช้ภาพของใคร แต่เขียนผ่าน worker เท่านั้น
create policy video_assets_select on video_assets
  for select to authenticated
  using (is_org_member(org_id));
