-- คลิปโฆษณาสั้นที่สร้างด้วย AI (Veo / Runway)
--
-- ทำไมเป็นตารางใหม่ ไม่ยัดลง videos: คนละสินค้ากัน
-- videos = คลิปเล่าเรื่อง 8–45 นาที ประกอบจากภาพนิ่ง + เสียงพากย์ (~฿10/คลิป)
-- ตารางนี้ = คลิปโฆษณา 8 วินาทีที่โมเดลสร้างให้ทั้งคลิป (~฿14–100/ชิ้น)
-- ต่างกันทั้งวิธีผลิต ต้นทุน และวิธีวัดผล ยัดรวมกันแล้วทุกคำถามต้องถามว่า
-- "ของแบบไหน" ก่อนทุกครั้ง
--
-- ⚠️ ใช้ org_id ไม่ใช่ workspace_id — ทั้งระบบ yt-factory ใช้ org_id
-- (แผนที่ร่างไว้เขียน workspace_id ซึ่งเป็นของอีกโปรเจค)

create type video_gen_status as enum ('queued', 'running', 'done', 'failed');

create table video_generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,

  -- ผูกกับช่องได้ แต่ไม่บังคับ — โฆษณาบางชิ้นทำเพื่อยิงแอด ไม่ได้ลงช่อง
  channel_id uuid references channels (id) on delete set null,

  prompt text not null,
  /** 9:16 สำหรับ Shorts/Reels/TikTok · 16:9 สำหรับเว็บและ YouTube แนวนอน */
  aspect text not null check (aspect in ('9:16', '16:9')),
  seconds integer not null check (seconds between 1 and 60),

  provider text not null,
  model text not null,
  tier text not null check (tier in ('lite', 'fast', 'quality')),

  status video_gen_status not null default 'queued',
  /** id ฝั่งผู้ให้บริการ — ไม่มีอันนี้ = ถามสถานะไม่ได้และเงินที่จ่ายไปสูญ */
  provider_job_id text,

  /**
   * ราคาที่ "ประมาณไว้ตอนสั่ง" ไม่ใช่ราคาจากบิลจริง
   * เก็บไว้เพราะเป็นตัวเลขเดียวที่มีตอนตัดสินใจ และต้องเทียบกับบิลจริงทีหลังได้
   * ห้ามเอาไปคิดกำไรขาดทุนตรง ๆ
   */
  cost_usd numeric(10, 4) not null default 0,

  /** พาธในบัคเก็ต generated-videos — มีเมื่อโหลดไฟล์เก็บแล้ว */
  storage_path text,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index video_generations_org_idx on video_generations (org_id, created_at desc);

-- งานที่ยังไม่จบต้องหาเจอเร็ว เพราะ worker ต้องวนถามสถานะเป็นระยะ
create index video_generations_pending_idx on video_generations (status)
  where status in ('queued', 'running');

create trigger video_generations_touch before update on video_generations
  for each row execute function touch_updated_at();

alter table video_generations enable row level security;

-- อ่านได้ทั้งองค์กร · เขียนผ่าน worker (service role) เท่านั้น เหมือน videos
-- ปล่อยให้ client เขียนเองแปลว่าใครก็สั่งให้เงินออกได้โดยไม่ผ่านด่านคุมงบ
create policy video_generations_select on video_generations
  for select to authenticated
  using (is_org_member(org_id));

-- ── ที่เก็บไฟล์ ──────────────────────────────────────────────────────
-- แยกบัคเก็ตจาก videos เพราะคนละสินค้าและคนละอายุการเก็บ
-- (โฆษณาที่ทดสอบแล้วไม่เวิร์กควรลบทิ้งได้โดยไม่แตะคลิปเล่าเรื่อง)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-videos', 'generated-videos', false, 536870912, array['video/mp4'])
on conflict (id) do nothing;

create policy "org members read own generated videos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'generated-videos'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

comment on table video_generations is
  'คลิปโฆษณาสั้นที่โมเดลสร้างให้ทั้งคลิป — แยกจาก videos ซึ่งเป็นคลิปเล่าเรื่องที่ประกอบเอง';
