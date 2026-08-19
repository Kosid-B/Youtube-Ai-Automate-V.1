-- ข้อมูลสำหรับหน้า "สายการผลิต" — ตอบ 4 คำถามในหน้าจอเดียว
--
-- ทำเป็น rpc แทนที่จะให้หน้าเว็บยิงหลาย query เพราะ:
-- 1. youtube_quota เปิด RLS ไว้แต่ไม่มี policy เลย ฝั่ง client อ่านตรง ๆ ไม่ได้ (ตั้งใจ)
-- 2. โหลดหน้าต้องไม่เกิน 5 วินาที — รวมเป็นรอบเดียวดีกว่ายิง 6 รอบ

-- ── เป้าการผลิตต่อเดือน ──────────────────────────────────────────────
-- ไม่มีที่เก็บมาก่อน ทำให้ KPI "ผลิตได้ตามเป้าไหม" ไม่มีตัวหาร
alter table organizations
  add column monthly_target integer not null default 20 check (monthly_target > 0);

comment on column organizations.monthly_target is
  'เป้าจำนวนคลิปต่อเดือน — ใช้เป็นตัวหารของแถบความคืบหน้าในหน้าสายการผลิต';

-- ── งานที่ต้องแตะเอง ─────────────────────────────────────────────────
--
-- สามเงื่อนไข ไม่ใช่แค่ dead:
--   dead    = ลองครบแล้วยังไม่ผ่าน คืนเครดิตแล้ว รอคนตัดสินใจ
--   claimed ค้าง = worker ตายกลางทาง ← โหมดพังที่เงียบที่สุดของคิว
--                  งานจะค้างสถานะนี้ตลอดไป ไม่มีใครหยิบต่อ และไม่มีอะไรฟ้อง
--   queued  ค้าง = ไม่มี worker รันอยู่เลย (ลืมเปิดหน้าต่างที่สอง)
create function pipeline_stuck_jobs(p_org_id uuid)
returns table (
  job_id uuid,
  kind text,
  reason text,
  stuck_since timestamptz,
  last_error text,
  can_requeue boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  return query
  select
    j.id,
    j.kind,
    case
      when j.status = 'dead' then 'ตายถาวร'
      when j.status = 'claimed' then 'worker ไม่ตอบสนอง'
      else 'ไม่มี worker รับงาน'
    end,
    coalesce(j.claimed_at, j.run_after),
    j.last_error,
    -- งานที่ค้างเพราะ worker ตายเอากลับเข้าคิวได้ ส่วน dead ต้องคนดูก่อน
    j.status = 'claimed'
  from jobs j
  where j.org_id = p_org_id
    and (
      j.status = 'dead'
      or (j.status = 'claimed' and j.claimed_at < now() - interval '30 minutes')
      or (j.status = 'queued' and j.run_after < now() - interval '15 minutes')
    )
  order by coalesce(j.claimed_at, j.run_after);
end;
$$;

revoke execute on function pipeline_stuck_jobs (uuid) from public;
grant execute on function pipeline_stuck_jobs (uuid) to authenticated, service_role;

-- ── ปลดล็อกงานที่ worker ตายคาไว้ ────────────────────────────────────
create function requeue_stuck_job(p_job_id uuid)
returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare result jobs;
begin
  update jobs
  set status = 'queued', claimed_at = null, claimed_by = null,
      run_after = now(), updated_at = now()
  where id = p_job_id
    and status = 'claimed'
    and claimed_at < now() - interval '30 minutes'
    -- ตรวจสิทธิ์ใน where ไม่ใช่ก่อนหน้า จะได้ไม่รั่วว่ามี job นี้อยู่จริงไหม
    and has_org_role (org_id, array['owner', 'admin', 'editor']::org_role[])
  returning * into result;

  if not found then
    raise exception 'ปลดล็อกงานนี้ไม่ได้ — อาจไม่ค้าง ไม่มีอยู่ หรือไม่มีสิทธิ์';
  end if;

  return result;
end;
$$;

revoke execute on function requeue_stuck_job (uuid) from public;
grant execute on function requeue_stuck_job (uuid) to authenticated, service_role;

-- ── โควตาอัปโหลดที่เหลือวันนี้ ───────────────────────────────────────
--
-- คืนหน่วยเป็น "คลิป" ไม่ใช่ "quota unit" — เลขดิบของ YouTube ไม่ช่วยตัดสินใจอะไร
-- ⚠️ ช่องที่ไม่ได้ปักหมุด project ใช้คลังกลางร่วมกับองค์กรอื่น ตัวเลขที่คืนจึงเป็น
--    "ความจุที่ยังว่างอยู่" ไม่ใช่ "โควตาที่สงวนไว้ให้เรา" — is_shared บอกจุดนี้
create function quota_remaining_clips(p_org_id uuid, p_units_per_clip integer default 1600)
returns table (clips_left integer, units_left integer, is_shared boolean, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_pooled boolean;
  v_keys text[];
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  select
    bool_or(c.quota_project_key is null),
    array_agg(distinct c.quota_project_key) filter (where c.quota_project_key is not null)
  into v_has_pooled, v_keys
  from channels c where c.org_id = p_org_id;

  return query
  with usable as (
    select p.key, p.daily_limit
    from youtube_projects p
    where p.enabled
      and (coalesce(v_has_pooled, false) or p.key = any(coalesce(v_keys, array[]::text[])))
  )
  select
    (greatest(sum(u.daily_limit - coalesce(q.used, 0)), 0) / p_units_per_clip)::integer,
    greatest(sum(u.daily_limit - coalesce(q.used, 0)), 0)::integer,
    coalesce(v_has_pooled, false),
    quota_resets_at()
  from usable u
  left join youtube_quota q on q.project_key = u.key and q.quota_date = quota_day();
end;
$$;

revoke execute on function quota_remaining_clips (uuid, integer) from public;
grant execute on function quota_remaining_clips (uuid, integer) to authenticated, service_role;

-- ── ตัวเลขสรุปบนหัวหน้าจอ ────────────────────────────────────────────
create function pipeline_summary(p_org_id uuid)
returns table (
  stuck_count integer,
  credits_used_month integer,
  clips_done_month integer,
  monthly_target integer,
  queued_count integer,
  running_count integer,
  done_today integer
)
language plpgsql
security definer
set search_path = public
as $$
declare v_month_start timestamptz;
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  -- ตัดเดือนตามเวลาไทย ไม่ใช่ UTC — เดือนของผู้ใช้ขึ้นกับปฏิทินที่เขาใช้จริง
  v_month_start := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';

  return query
  select
    (select count(*) from pipeline_stuck_jobs(p_org_id))::integer,
    (select coalesce(sum(-l.delta), 0) from credit_ledger l
      where l.org_id = p_org_id and l.delta < 0 and l.created_at >= v_month_start)::integer,
    (select count(*) from videos v
      where v.org_id = p_org_id and v.status in ('ready', 'scheduled', 'published')
        and v.updated_at >= v_month_start)::integer,
    (select o.monthly_target from organizations o where o.id = p_org_id),
    (select count(*) from jobs j where j.org_id = p_org_id and j.status = 'queued')::integer,
    (select count(*) from jobs j where j.org_id = p_org_id and j.status = 'claimed')::integer,
    (select count(*) from jobs j where j.org_id = p_org_id and j.status = 'done'
      and j.updated_at >= date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')::integer;
end;
$$;

revoke execute on function pipeline_summary (uuid) from public;
grant execute on function pipeline_summary (uuid) to authenticated, service_role;

-- ── ซีรีส์รายวันสำหรับกราฟ ───────────────────────────────────────────
--
-- คืนทุกวันแม้วันที่ไม่มีงาน (generate_series) ไม่งั้นกราฟจะกระโดดข้ามวัน
-- แล้วอ่านผิดว่าผลิตสม่ำเสมอกว่าความจริง
create function pipeline_daily(p_org_id uuid, p_days integer default 30)
returns table (day date, clips_done integer, credits_used integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  if p_days not between 1 and 180 then
    raise exception 'ขอย้อนหลังได้ 1–180 วัน';
  end if;

  return query
  with days as (
    select generate_series(
      (now() at time zone 'Asia/Bangkok')::date - (p_days - 1),
      (now() at time zone 'Asia/Bangkok')::date,
      interval '1 day'
    )::date as d
  )
  select
    days.d,
    (select count(*) from videos v
      where v.org_id = p_org_id and v.status in ('ready', 'scheduled', 'published')
        and (v.updated_at at time zone 'Asia/Bangkok')::date = days.d)::integer,
    (select coalesce(sum(-l.delta), 0) from credit_ledger l
      where l.org_id = p_org_id and l.delta < 0
        and (l.created_at at time zone 'Asia/Bangkok')::date = days.d)::integer
  from days
  order by days.d;
end;
$$;

revoke execute on function pipeline_daily (uuid, integer) from public;
grant execute on function pipeline_daily (uuid, integer) to authenticated, service_role;
