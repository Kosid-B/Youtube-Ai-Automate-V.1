-- ชั้นข้อมูลสำหรับวิเคราะห์ว่า "คอนเทนต์แบบไหนได้ผล"
--
-- ของเดิมมีแต่ผลลัพธ์ (video_metrics: views/ctr/avd/rpm) แต่ไม่มีคุณลักษณะของคอนเทนต์
-- จึงตอบได้แค่ "คลิปไหนดี" ตอบไม่ได้ว่า "ดีเพราะอะไร" — ตารางนี้เก็บฝั่งคุณลักษณะ
-- เพื่อให้จับคู่ เหตุ → ผล ได้
--
-- หลักสำคัญ: บันทึกตอนเผยแพร่แล้วห้ามแก้ย้อนหลัง ไม่งั้นข้อมูลจะปนเปื้อนจากการรู้ผลลัพธ์
-- (hindsight bias — เห็นว่าคลิปปัง แล้วย้อนกลับไปติดป้ายว่า hook ดี)

-- ── คุณลักษณะของคอนเทนต์ ──────────────────────────────────────────────
create table content_features (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  video_id uuid not null unique references videos (id) on delete cascade,

  -- ── กลุ่มที่ระบบเติมเอง (วัดได้ ไม่ต้องตีความ) ──
  script_chars integer,
  scene_count integer,
  duration_seconds integer,
  image_count integer,
  title_chars integer,
  title_has_number boolean,
  title_has_question boolean,
  published_dow smallint check (published_dow between 0 and 6),
  published_hour smallint check (published_hour between 0 and 23),

  -- ── กลุ่มที่คนหรือ AI ติดป้าย (ต้องตีความ) ──
  hook_type text check (hook_type in
    ('question', 'number', 'contrarian', 'story', 'news', 'howto', 'warning')),
  tone text check (tone in ('calm', 'urgent', 'analytical', 'friendly')),
  thumbnail_style text check (thumbnail_style in
    ('face', 'text_only', 'chart', 'object', 'none')),
  cta_type text check (cta_type in ('comment', 'link', 'subscribe', 'none')),
  topic text,
  labeled_by text check (labeled_by in ('human', 'ai')),

  captured_at timestamptz not null default now()
);

create index content_features_org_idx on content_features (org_id);
create index content_features_hook_idx on content_features (org_id, hook_type);
create index content_features_topic_idx on content_features (org_id, topic);

alter table content_features enable row level security;

create policy content_features_select on content_features
  for select using (is_org_member (org_id));

create policy content_features_write on content_features
  for all using (has_org_role (org_id, array['owner', 'admin', 'editor']::org_role[]))
  with check (has_org_role (org_id, array['owner', 'admin', 'editor']::org_role[]));

-- ── เติมคุณลักษณะที่วัดได้เอง ────────────────────────────────────────
--
-- แยกจากการติดป้ายเพราะส่วนนี้ไม่มีการตีความ เรียกซ้ำได้ผลเท่าเดิมเสมอ
-- เรียกตอนเผยแพร่ (หรือย้อนหลังก็ได้ ค่าที่ได้ไม่ขึ้นกับผลลัพธ์)
create function capture_content_features(p_video_id uuid)
returns content_features
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  result content_features;
begin
  select
    vd.id, vd.org_id, vd.title, vd.published_at,
    length(coalesce(s.body, '')) as body_chars,
    (select count(*) from video_assets va where va.video_id = vd.id) as images
  into v
  from videos vd
  join scripts s on s.id = vd.script_id
  where vd.id = p_video_id;

  if not found then
    raise exception 'ไม่พบคลิป %', p_video_id;
  end if;

  insert into content_features (
    org_id, video_id, script_chars, image_count, title_chars,
    title_has_number, title_has_question, published_dow, published_hour
  )
  values (
    v.org_id,
    v.id,
    v.body_chars,
    v.images,
    length(v.title),
    v.title ~ '[0-9๐-๙]',
    v.title like '%?%' or v.title ~ 'ไหม|หรือ|ทำไม|อะไร|ยังไง',
    -- เวลาไทย ไม่ใช่ UTC — ผู้ชมอยู่ไทย พฤติกรรมผูกกับเวลาท้องถิ่น
    extract(dow from v.published_at at time zone 'Asia/Bangkok')::smallint,
    extract(hour from v.published_at at time zone 'Asia/Bangkok')::smallint
  )
  on conflict (video_id) do update set
    script_chars = excluded.script_chars,
    image_count = excluded.image_count,
    title_chars = excluded.title_chars,
    title_has_number = excluded.title_has_number,
    title_has_question = excluded.title_has_question,
    published_dow = excluded.published_dow,
    published_hour = excluded.published_hour
  returning * into result;

  return result;
end;
$$;

revoke execute on function capture_content_features (uuid) from public;
grant execute on function capture_content_features (uuid) to authenticated, service_role;

-- ── มุมมองรวม เหตุ + ผล ──────────────────────────────────────────────
--
-- security_invoker = RLS ของตารางต้นทางยังบังคับใช้ ไม่ใช่ช่องรั่วข้าม org
create view content_performance
with (security_invoker = on) as
select
  f.org_id,
  f.video_id,
  v.title,
  v.channel_id,
  v.published_at,
  f.hook_type,
  f.tone,
  f.thumbnail_style,
  f.cta_type,
  f.topic,
  f.script_chars,
  f.scene_count,
  f.duration_seconds,
  f.published_dow,
  f.published_hour,
  f.title_chars,
  f.title_has_number,
  f.title_has_question,
  m.views_28d,
  m.ctr_avg,
  m.avd_avg_seconds,
  -- สัดส่วนการดูจบ เทียบได้ข้ามคลิปที่ยาวไม่เท่ากัน ต่างจาก avd ดิบ
  case
    when f.duration_seconds > 0 then round(m.avd_avg_seconds::numeric / f.duration_seconds, 4)
  end as avd_ratio,
  m.rpm_avg,
  m.days_measured
from content_features f
join videos v on v.id = f.video_id
left join lateral (
  select
    sum(vm.views) as views_28d,
    round(avg(vm.ctr), 4) as ctr_avg,
    round(avg(vm.avd_seconds))::integer as avd_avg_seconds,
    round(avg(vm.rpm), 2) as rpm_avg,
    count(*)::integer as days_measured
  from video_metrics vm
  where vm.video_id = f.video_id
    and vm.day <= (v.published_at at time zone 'Asia/Bangkok')::date + 28
) m on true;

-- ── สรุปต่อคุณลักษณะ ─────────────────────────────────────────────────
--
-- ⚠️ คืน sample_size มาด้วยเสมอ และคิดค่ากลางด้วย median ไม่ใช่ mean
-- เพราะยอดวิว YouTube เบ้หนักมาก คลิปเดียวที่ปังทำให้ค่าเฉลี่ยหลอกตาได้
create function content_feature_summary(p_org_id uuid, p_feature text)
returns table (
  feature_value text,
  sample_size bigint,
  median_views numeric,
  median_avd_ratio numeric,
  median_ctr numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  if p_feature not in ('hook_type', 'tone', 'thumbnail_style', 'cta_type', 'topic') then
    raise exception 'จัดกลุ่มตาม % ไม่ได้ — รองรับเฉพาะ hook_type, tone, thumbnail_style, cta_type, topic', p_feature;
  end if;

  return query execute format($q$
    select
      %I::text as feature_value,
      count(*) as sample_size,
      -- percentile_cont คืน double precision ต้อง cast กลับเป็น numeric
      -- ไม่งั้นชนกับ returns table ที่ประกาศไว้ (พังตอนเรียกจริงเท่านั้น ไม่ใช่ตอนสร้าง)
      percentile_cont(0.5) within group (order by views_28d)::numeric as median_views,
      percentile_cont(0.5) within group (order by avd_ratio)::numeric as median_avd_ratio,
      percentile_cont(0.5) within group (order by ctr_avg)::numeric as median_ctr
    from content_performance
    where org_id = %L and %I is not null and views_28d is not null
    group by %I
    order by median_views desc nulls last
  $q$, p_feature, p_org_id, p_feature, p_feature);
end;
$$;

revoke execute on function content_feature_summary (uuid, text) from public;
grant execute on function content_feature_summary (uuid, text) to authenticated, service_role;

comment on table content_features is
  'คุณลักษณะของคอนเทนต์ตอนเผยแพร่ — จับคู่กับ video_metrics เพื่อตอบว่าอะไรได้ผล ห้ามแก้ย้อนหลังหลังรู้ผล';
comment on view content_performance is
  'เหตุ (content_features) + ผล (video_metrics 28 วันแรก) ในมุมมองเดียว';
