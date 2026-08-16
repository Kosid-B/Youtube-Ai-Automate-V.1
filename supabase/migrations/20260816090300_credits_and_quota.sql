-- เครดิต + โควตา YouTube API
-- เครดิตตัดตอน "เข้าคิว" ไม่ใช่ตอนงานเสร็จ เพื่อกันการยิงซ้ำ

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  -- ติดลบ = ใช้เครดิต, บวก = เติม/คืนเครดิต
  delta integer not null,
  balance_after integer not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index credit_ledger_org_idx on credit_ledger (org_id, created_at desc);

alter table credit_ledger enable row level security;

-- อ่านได้ทุกคนในองค์กร · เขียนผ่าน rpc เท่านั้น (ไม่มี policy insert/update)
create policy credit_ledger_select on credit_ledger
  for select to authenticated
  using (is_org_member(org_id));

-- ── ตัดเครดิต ─────────────────────────────────────────────────────────────
create function consume_credits(
  p_org_id uuid,
  p_amount integer,
  p_reason text,
  p_ref_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'จำนวนเครดิตต้องมากกว่า 0';
  end if;

  -- security definer ข้าม RLS จึงต้องตรวจสิทธิ์เอง
  if not is_service_role() and not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์ใช้เครดิตขององค์กรนี้';
  end if;

  perform set_config('app.credits_rpc', 'on', true);

  update organizations
     set credits = credits - p_amount
   where id = p_org_id
     and credits >= p_amount
  returning credits into v_balance;

  if not found then
    raise exception 'เครดิตไม่พอ' using errcode = 'P0002';
  end if;

  insert into credit_ledger (org_id, delta, balance_after, reason, ref_id)
  values (p_org_id, -p_amount, v_balance, p_reason, p_ref_id);

  return v_balance;
end;
$$;

-- ── เติม / คืนเครดิต ──────────────────────────────────────────────────────
-- ใช้โดย Stripe webhook (งานค้างข้อ 5) และการคืนเครดิตงาน dead (งานค้างข้อ 3)
create function grant_credits(
  p_org_id uuid,
  p_amount integer,
  p_reason text,
  p_ref_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'จำนวนเครดิตต้องมากกว่า 0';
  end if;

  if not is_service_role() then
    raise exception 'เติมเครดิตได้จากฝั่ง server เท่านั้น';
  end if;

  -- กันการคืนเครดิตซ้ำเมื่อ webhook หรือ worker ยิงซ้ำ
  if p_ref_id is not null and exists (
    select 1 from credit_ledger
     where ref_id = p_ref_id and reason = p_reason and delta > 0
  ) then
    select credits into v_balance from organizations where id = p_org_id;
    return v_balance;
  end if;

  perform set_config('app.credits_rpc', 'on', true);

  update organizations
     set credits = credits + p_amount
   where id = p_org_id
  returning credits into v_balance;

  if not found then
    raise exception 'ไม่พบองค์กร %', p_org_id;
  end if;

  insert into credit_ledger (org_id, delta, balance_after, reason, ref_id)
  values (p_org_id, p_amount, v_balance, p_reason, p_ref_id);

  return v_balance;
end;
$$;

revoke execute on function grant_credits(uuid, integer, text, uuid) from public;
grant execute on function grant_credits(uuid, integer, text, uuid) to service_role;

-- ── เข้าคิวงาน (ตัดเครดิตในทรานแซกชันเดียวกัน) ────────────────────────────
create function enqueue_job(
  p_org_id uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_cost integer default 0,
  p_run_after timestamptz default now()
) returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs;
begin
  if not is_service_role() and not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์สร้างงานให้องค์กรนี้';
  end if;

  insert into jobs (org_id, kind, payload, run_after)
  values (p_org_id, p_kind, p_payload, p_run_after)
  returning * into v_job;

  if p_cost > 0 then
    perform consume_credits(p_org_id, p_cost, 'job:' || p_kind, v_job.id);
  end if;

  return v_job;
end;
$$;

-- ── โควตา YouTube Data API ────────────────────────────────────────────────
-- 10,000 units/วัน/project · videos.insert = 1,600 units → ~6 คลิป/project/วัน
-- โควตารีเซ็ตเที่ยงคืนเวลาแปซิฟิก จึงนับวันตามโซนนั้น ไม่ใช่ UTC
create table youtube_quota (
  project_key text not null,
  quota_date date not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_key, quota_date)
);

alter table youtube_quota enable row level security;
-- ไม่มี policy = ผู้ใช้เข้าไม่ถึงเลย เข้าผ่าน rpc ฝั่ง server เท่านั้น

create function quota_day() returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

-- เวลารีเซ็ตโควตารอบถัดไป (ใช้ตั้ง run_after ตอนเลื่อนงาน)
create function quota_resets_at() returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((quota_day() + 1)::timestamp at time zone 'America/Los_Angeles');
$$;

-- จองโควตาก่อนยิง API จริงเสมอ ห้ามยิงแล้วค่อยนับ
-- คืน true = จองสำเร็จ ยิงได้ · false = โควตาไม่พอ ให้เลื่อนงานไปวันถัดไป
create function reserve_quota(
  p_project_key text,
  p_units integer,
  p_daily_limit integer default 10000
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := quota_day();
  v_used integer;
begin
  if not is_service_role() then
    raise exception 'จองโควตาได้จากฝั่ง server เท่านั้น';
  end if;

  insert into youtube_quota (project_key, quota_date, used)
  values (p_project_key, v_day, 0)
  on conflict (project_key, quota_date) do nothing;

  -- ล็อกแถวไว้ก่อน กันสอง worker จองพร้อมกันจนเกินเพดาน
  select used into v_used
    from youtube_quota
   where project_key = p_project_key and quota_date = v_day
   for update;

  if v_used + p_units > p_daily_limit then
    return false;
  end if;

  update youtube_quota
     set used = v_used + p_units, updated_at = now()
   where project_key = p_project_key and quota_date = v_day;

  return true;
end;
$$;

-- คืนโควตาที่จองไว้เมื่อการเรียก API ล้มเหลวก่อนถึงตัวนับของ Google
create function release_quota(p_project_key text, p_units integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_service_role() then
    raise exception 'คืนโควตาได้จากฝั่ง server เท่านั้น';
  end if;

  update youtube_quota
     set used = greatest(used - p_units, 0), updated_at = now()
   where project_key = p_project_key and quota_date = quota_day();
end;
$$;

-- revoke จาก public (ค่าเริ่มต้นของ Postgres ให้ EXECUTE กับ PUBLIC) แล้วคืนให้ service_role
revoke execute on function reserve_quota(text, integer, integer) from public;
revoke execute on function release_quota(text, integer) from public;

grant execute on function reserve_quota(text, integer, integer) to service_role;
grant execute on function release_quota(text, integer) to service_role;
