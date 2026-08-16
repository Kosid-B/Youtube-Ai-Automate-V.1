-- ตารางสายการผลิต: ช่อง → ไอเดีย → สคริปต์ → คลิป → ตัวเลขผลงาน

create type script_status as enum ('draft', 'checking', 'ready', 'blocked');
create type video_status as enum ('queued', 'rendering', 'ready', 'scheduled', 'published', 'failed', 'blocked');

create table channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  niche text,
  youtube_channel_id text,
  -- id ของ secret ใน Supabase Vault ที่เก็บ refresh token
  -- ⚠️ ห้ามเก็บ token เป็น plaintext ในตารางนี้ (ดูงานค้างข้อ 1)
  oauth_secret_id uuid,
  -- คีย์ของ Google Cloud project ที่ช่องนี้ใช้โควตา (ดู youtube_quota)
  quota_project_key text not null default 'default',
  created_at timestamptz not null default now()
);

create index channels_org_idx on channels (org_id);

create table ideas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  title text not null,
  angle text,
  source_note text,
  score numeric(4, 2),
  created_at timestamptz not null default now()
);

create index ideas_channel_idx on ideas (channel_id, created_at desc);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  idea_id uuid references ideas (id) on delete set null,
  title text not null,
  body text,
  status script_status not null default 'draft',
  -- ผลตรวจความเป็นต้นฉบับล่าสุด (ดู src/lib/originality.ts)
  originality jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scripts_channel_idx on scripts (channel_id, created_at desc);
create index scripts_status_idx on scripts (org_id, status);

create table videos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  script_id uuid not null references scripts (id) on delete restrict,
  title text not null,
  description text,
  status video_status not null default 'queued',
  storage_path text,
  youtube_video_id text,
  publish_at timestamptz,
  published_at timestamptz,
  block_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index videos_channel_idx on videos (channel_id, created_at desc);
create index videos_publish_idx on videos (status, publish_at);

create table video_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  video_id uuid not null references videos (id) on delete cascade,
  day date not null,
  views integer not null default 0,
  ctr numeric(6, 4),
  avd_seconds integer,
  rpm numeric(10, 2),
  synced_at timestamptz not null default now(),
  unique (video_id, day)
);

create index video_metrics_org_day_idx on video_metrics (org_id, day desc);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table channels enable row level security;
alter table ideas enable row level security;
alter table scripts enable row level security;
alter table videos enable row level security;
alter table video_metrics enable row level security;

-- อ่านได้ทุกคนในองค์กร · เขียนได้ตั้งแต่ editor ขึ้นไป
do $$
declare
  t text;
begin
  foreach t in array array['channels', 'ideas', 'scripts', 'videos'] loop
    execute format($p$
      create policy %1$s_select on %1$s
        for select to authenticated
        using (is_org_member(org_id));

      create policy %1$s_write on %1$s
        for all to authenticated
        using (has_org_role(org_id, array['owner', 'admin', 'editor']::org_role[]))
        with check (has_org_role(org_id, array['owner', 'admin', 'editor']::org_role[]));
    $p$, t);
  end loop;
end;
$$;

-- ตัวเลขผลงานเขียนโดย worker (metrics_sync) เท่านั้น ผู้ใช้อ่านได้อย่างเดียว
create policy video_metrics_select on video_metrics
  for select to authenticated
  using (is_org_member(org_id));

create function touch_updated_at() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger scripts_touch before update on scripts
  for each row execute function touch_updated_at();

create trigger videos_touch before update on videos
  for each row execute function touch_updated_at();
