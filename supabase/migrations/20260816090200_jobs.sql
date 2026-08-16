-- คิวงานสำหรับ worker
-- กติกา: worker ดึงงานผ่าน claim_job (FOR UPDATE SKIP LOCKED) เท่านั้น
--        และต้องปิดงานด้วย complete_job เสมอ แม้ handler จะ throw

create type job_status as enum ('queued', 'claimed', 'done', 'failed', 'dead');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  -- 'script_generate' | 'video_render' | 'youtube_upload' | 'metrics_sync'
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- index สำหรับการดึงงาน: แคบเฉพาะงานที่ยังรอคิว
-- แยกสองตัวเพราะ claim_job เรียกได้ทั้งแบบระบุ kind และแบบไม่ระบุ (worker ทั่วไป)
create index jobs_pickup_idx on jobs (run_after) where status = 'queued';
create index jobs_pickup_kind_idx on jobs (kind, run_after) where status = 'queued';
create index jobs_org_idx on jobs (org_id, created_at desc);

create trigger jobs_touch before update on jobs
  for each row execute function touch_updated_at();

alter table jobs enable row level security;

-- ผู้ใช้ดูสถานะงานขององค์กรตัวเองได้ แต่เขียนไม่ได้
-- การสร้างงานต้องผ่าน enqueue_job (ซึ่งตัดเครดิตให้ในทีเดียว)
create policy jobs_select on jobs
  for select to authenticated
  using (is_org_member(org_id));

-- ── ดึงงาน ────────────────────────────────────────────────────────────────
-- SKIP LOCKED ทำให้ worker หลายตัวดึงพร้อมกันได้โดยไม่ชนกัน
create function claim_job(p_worker_id text, p_kinds text[] default null)
returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs;
begin
  -- กันไว้อีกชั้นเผื่อ grant เพี้ยน — คิวงานเป็นของ worker เท่านั้น
  if not is_service_role() then
    raise exception 'ดึงงานได้จากฝั่ง server เท่านั้น';
  end if;

  select *
    into v_job
    from jobs
   where status = 'queued'
     and run_after <= now()
     and (p_kinds is null or kind = any (p_kinds))
   order by run_after asc
   for update skip locked
   limit 1;

  if not found then
    return null;
  end if;

  update jobs
     set status = 'claimed',
         attempts = attempts + 1,
         claimed_at = now(),
         claimed_by = p_worker_id
   where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

-- ── ปิดงาน ────────────────────────────────────────────────────────────────
-- ล้มเหลวแล้วยังเหลือ attempt → กลับเข้าคิวพร้อม backoff แบบทวีคูณ
-- ล้มเหลวจนครบ max_attempts → dead (worker จะคืนเครดิตให้ผ่าน grant_credits)
create function complete_job(p_job_id uuid, p_ok boolean, p_error text default null)
returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs;
begin
  if not is_service_role() then
    raise exception 'ปิดงานได้จากฝั่ง server เท่านั้น';
  end if;

  select * into v_job from jobs where id = p_job_id for update;

  if not found then
    raise exception 'ไม่พบงาน %', p_job_id;
  end if;

  if p_ok then
    update jobs
       set status = 'done', last_error = null
     where id = p_job_id
    returning * into v_job;
  elsif v_job.attempts >= v_job.max_attempts then
    update jobs
       set status = 'dead', last_error = p_error
     where id = p_job_id
    returning * into v_job;
  else
    update jobs
       set status = 'queued',
           last_error = p_error,
           claimed_by = null,
           claimed_at = null,
           run_after = now() + (power(2, v_job.attempts) * interval '1 minute')
     where id = p_job_id
    returning * into v_job;
  end if;

  return v_job;
end;
$$;

-- ── เลื่อนงาน ─────────────────────────────────────────────────────────────
-- ใช้ตอนโควตา YouTube เต็ม: ไม่ใช่ความล้มเหลวของงาน จึงคืน attempt ให้ด้วย
-- (ห้าม retry ทันที เพราะจะเผาโควตาของ project อื่นเปล่า ๆ)
create function defer_job(p_job_id uuid, p_run_after timestamptz, p_reason text default null)
returns jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs;
begin
  if not is_service_role() then
    raise exception 'เลื่อนงานได้จากฝั่ง server เท่านั้น';
  end if;

  update jobs
     set status = 'queued',
         attempts = greatest(attempts - 1, 0),
         claimed_by = null,
         claimed_at = null,
         run_after = p_run_after,
         last_error = p_reason
   where id = p_job_id
  returning * into v_job;

  if not found then
    raise exception 'ไม่พบงาน %', p_job_id;
  end if;

  return v_job;
end;
$$;

-- ⚠️ ต้อง revoke จาก public ไม่ใช่แค่ anon/authenticated
-- Postgres ให้ EXECUTE กับ PUBLIC เป็นค่าเริ่มต้น ถ้า revoke ไม่ครบ ผู้ใช้ที่ล็อกอินแล้ว
-- จะเรียกฟังก์ชันพวกนี้ผ่าน PostgREST rpc แล้วไปยุ่งกับงานขององค์กรอื่นได้
revoke execute on function claim_job(text, text[]) from public;
revoke execute on function complete_job(uuid, boolean, text) from public;
revoke execute on function defer_job(uuid, timestamptz, text) from public;

grant execute on function claim_job(text, text[]) to service_role;
grant execute on function complete_job(uuid, boolean, text) to service_role;
grant execute on function defer_job(uuid, timestamptz, text) to service_role;
