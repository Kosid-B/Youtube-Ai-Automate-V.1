-- ฐานข้อมูลของสายงานคลิปโฆษณา: โปรเจค → สคริปต์ → การสร้าง → ผลวัด
--
-- ⚠️ ใช้ org_id ไม่ใช่ workspace_id
-- สเปคที่ร่างไว้เขียน workspace_id ซึ่งเป็น convention ของ CEO AI Thailand
-- ส่วน repo นี้ใช้ organizations / org_members / is_org_member() ทั้งระบบ
-- ใช้ workspace_id ตรงนี้ = RLS ทุก policy ในตารางใหม่จะอ้างฟังก์ชันที่ไม่มีอยู่
-- (กติกาข้อ 16.2 ของสเปคเองบอกให้ใช้ convention ที่มีอยู่)

-- ── โปรเจคหนึ่งชิ้นงานการตลาด ────────────────────────────────────────
create table video_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  -- คนสร้าง — ไว้ดูว่าใครสั่ง ไม่ได้ใช้ตัดสินสิทธิ์ (สิทธิ์มาจากสมาชิกองค์กร)
  created_by uuid not null references auth.users (id) on delete cascade,

  title text not null check (length(btrim(title)) between 1 and 200),
  /** เป้าหมายธุรกิจ เช่น "หาลูกค้าโรงงานใหม่" — เป็นต้นทางของทุกอย่างที่ AI คิดต่อ */
  objective text check (length(objective) <= 2000),
  audience text check (length(audience) <= 2000),
  platform text not null default 'youtube_shorts'
    check (platform in ('youtube_shorts', 'tiktok', 'instagram_reels', 'facebook', 'website')),
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16', '16:9')),
  status text not null default 'draft' check (status in ('draft', 'scripted', 'generating', 'ready', 'archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index video_projects_org_idx on video_projects (org_id, created_at desc);

-- ── สคริปต์ + สตอรีบอร์ด ─────────────────────────────────────────────
create table video_scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references video_projects (id) on delete cascade,
  -- ซ้ำ org_id ไว้ในทุกตารางโดยตั้งใจ: RLS ตรวจได้โดยไม่ต้อง join
  -- ซึ่งเร็วกว่าและอ่านง่ายกว่า และกันเคสที่ policy เขียนผิดจน join หลุด
  org_id uuid not null references organizations (id) on delete cascade,

  hook text check (length(hook) <= 1000),
  script text check (length(script) <= 20000),
  cta text check (length(cta) <= 1000),
  /** [{ shot, seconds, prompt }] — หนึ่งช็อตต่อหนึ่งการเรียกผู้ให้บริการ */
  storyboard jsonb not null default '[]'::jsonb
    check (jsonb_typeof(storyboard) = 'array'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index video_scripts_project_idx on video_scripts (project_id, created_at desc);

-- ── การสร้างวิดีโอหนึ่งครั้ง ─────────────────────────────────────────
-- ตารางนี้สร้างไว้แล้วในรอบก่อน (20260821100000) — รอบนี้เติมให้ครบตามสเปค
alter table video_generations
  add column project_id uuid references video_projects (id) on delete cascade,
  add column routing_policy text not null default 'auto'
    check (routing_policy in ('cheap', 'fast', 'quality', 'auto')),
  add column provider_output_url text,
  add column error_code text,
  -- แยก "ราคาที่ประมาณตอนสั่ง" กับ "ราคาจากบิลจริง" เพราะสองอย่างนี้ไม่เท่ากัน
  -- และการเอาค่าประมาณไปคิดกำไรขาดทุนคือวิธีที่ทำให้ตัวเลขธุรกิจผิดทั้งชุด
  add column actual_cost_usd numeric(10, 4);

alter table video_generations rename column cost_usd to estimated_cost_usd;
alter table video_generations rename column storage_path to output_storage_path;

create index video_generations_project_idx on video_generations (project_id, created_at desc);

-- ── ผลวัดของคลิปโฆษณา ────────────────────────────────────────────────
-- ตั้งชื่อ video_generation_metrics ไม่ใช่ video_metrics เพราะชื่อนั้นถูกใช้แล้ว
-- โดยตารางผลวัดของคลิปเล่าเรื่อง (ผูกกับ videos + ดึงจาก YouTube Analytics)
-- ยึดชื่อทับจะทำให้ metrics_sync ที่มีอยู่พัง
create table video_generation_metrics (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references video_generations (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,

  platform text not null
    check (platform in ('youtube_shorts', 'tiktok', 'instagram_reels', 'facebook', 'website')),

  impressions integer not null default 0 check (impressions >= 0),
  views integer not null default 0 check (views >= 0),
  watch_time_seconds integer not null default 0 check (watch_time_seconds >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  conversions integer not null default 0 check (conversions >= 0),

  measured_at date not null,
  created_at timestamptz not null default now(),

  -- หนึ่งคลิป หนึ่งแพลตฟอร์ม หนึ่งวัน หนึ่งแถว — ดึงซ้ำแล้วต้องทับ ไม่ใช่เพิ่ม
  unique (generation_id, platform, measured_at)
);

create index video_generation_metrics_org_idx on video_generation_metrics (org_id, measured_at desc);

-- ── updated_at ───────────────────────────────────────────────────────
create trigger video_projects_touch before update on video_projects
  for each row execute function touch_updated_at();
create trigger video_scripts_touch before update on video_scripts
  for each row execute function touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
-- กติกาเดียวกันทุกตาราง: เห็นเฉพาะองค์กรที่ตัวเองเป็นสมาชิก
--
-- ⚠️ policy ตรวจจาก org_id ของ "แถวในฐานข้อมูล" เทียบกับสมาชิกภาพของ auth.uid()
-- ไม่ได้เชื่อ org_id ที่เบราว์เซอร์ส่งมา — เบราว์เซอร์ส่งอะไรมาก็ได้
-- is_org_member() อ่าน auth.uid() จาก JWT ซึ่งปลอมไม่ได้
alter table video_projects enable row level security;
alter table video_scripts enable row level security;
alter table video_generation_metrics enable row level security;

create policy video_projects_select on video_projects
  for select to authenticated using (is_org_member(org_id));

-- เขียนได้เฉพาะ role ที่แก้เนื้อหาได้ และ WITH CHECK กันการ "ย้ายแถวข้ามองค์กร"
-- (มี USING อย่างเดียว = แก้ org_id ของแถวตัวเองให้ไปโผล่ในองค์กรอื่นได้)
create policy video_projects_write on video_projects
  for all to authenticated
  using (has_org_role(org_id, array['owner', 'admin', 'editor']::org_role[]))
  with check (has_org_role(org_id, array['owner', 'admin', 'editor']::org_role[]));

create policy video_scripts_select on video_scripts
  for select to authenticated using (is_org_member(org_id));

create policy video_scripts_write on video_scripts
  for all to authenticated
  using (has_org_role(org_id, array['owner', 'admin', 'editor']::org_role[]))
  with check (has_org_role(org_id, array['owner', 'admin', 'editor']::org_role[]));

-- ผลวัดอ่านได้ทั้งองค์กร แต่เขียนผ่าน worker (service role) เท่านั้น
-- ปล่อยให้ client เขียนเอง = ตัวเลขผลงานถูกแต่งได้
create policy video_generation_metrics_select on video_generation_metrics
  for select to authenticated using (is_org_member(org_id));

-- ── Storage ──────────────────────────────────────────────────────────
-- โครงพาธ: video-assets/<org_id>/<project_id>/<generation_id>/output.mp4
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-assets', 'video-assets', false, 536870912, array['video/mp4', 'video/webm'])
on conflict (id) do nothing;

create policy "org members read own video assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'video-assets'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

comment on table video_projects is 'ชิ้นงานการตลาดหนึ่งชิ้น — เป้าหมายธุรกิจเป็นต้นทางของสคริปต์และคลิป';
comment on table video_generation_metrics is
  'ผลวัดของคลิปโฆษณา — แยกจาก video_metrics ซึ่งเป็นของคลิปเล่าเรื่องที่ดึงจาก YouTube';
