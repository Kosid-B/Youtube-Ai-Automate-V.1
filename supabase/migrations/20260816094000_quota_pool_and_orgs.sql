-- ทำให้โควตา YouTube รองรับหลายลูกค้า + ให้ผู้ใช้ใหม่สร้างองค์กรของตัวเองได้
--
-- ปัญหาที่แก้: โควตา YouTube ผูกกับ Google Cloud project ของ "แอป" ไม่ใช่ของช่องลูกค้า
-- เดิมช่องหนึ่งผูก project key ตายตัว ถ้าทุกลูกค้าชี้ไป project เดียวกัน
-- ทั้งระบบจะอัปได้ ~6 คลิป/วันรวมกัน ไม่ใช่ต่อราย

-- ── คลัง project ──────────────────────────────────────────────────────────
create table youtube_projects (
  key text primary key,
  label text not null,
  daily_limit integer not null default 10000 check (daily_limit > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table youtube_projects enable row level security;
-- ไม่มี policy = ผู้ใช้เข้าไม่ถึง เป็นข้อมูลของผู้ให้บริการ ไม่ใช่ของลูกค้า

-- ช่องที่ไม่ได้ปักหมุด project เอง ให้ระบบเลือกจากคลังให้
-- (ลูกค้าองค์กรที่เอา Google Cloud project ตัวเองมาเชื่อม ยังปักหมุดได้เหมือนเดิม)
alter table channels alter column quota_project_key drop not null;
alter table channels alter column quota_project_key drop default;
update channels set quota_project_key = null where quota_project_key = 'default';

comment on column channels.quota_project_key is
  'ปักหมุด Google Cloud project เอง (BYO) — null = ให้ระบบเลือกจากคลัง youtube_projects';

-- ── จองโควตาโดยให้ระบบเลือก project ให้ ───────────────────────────────────
-- คืน key ของ project ที่จองได้ หรือ null ถ้าเต็มหมดทุกตัว
-- ไล่จาก project ที่ใช้ไปน้อยที่สุดก่อน เพื่อกระจายโหลดและกันไม่ให้ตัวใดตัวหนึ่งเต็มเร็ว
create function reserve_quota_from_pool(p_units integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := quota_day();
  v_project record;
begin
  if not is_service_role() then
    raise exception 'จองโควตาได้จากฝั่ง server เท่านั้น';
  end if;

  for v_project in
    select p.key, p.daily_limit, coalesce(q.used, 0) as used
      from youtube_projects p
      left join youtube_quota q
        on q.project_key = p.key and q.quota_date = v_day
     where p.enabled
     order by coalesce(q.used, 0) asc, p.key asc
  loop
    -- ข้ามตัวที่เห็น ๆ ว่าไม่พออยู่แล้ว ไม่ต้องไปล็อกแถวให้เปลือง
    if v_project.used + p_units > v_project.daily_limit then
      continue;
    end if;

    if reserve_quota(v_project.key, p_units, v_project.daily_limit) then
      return v_project.key;
    end if;
  end loop;

  return null;
end;
$$;

-- เลือกให้ตามช่อง: ปักหมุดไว้ก็ใช้ตัวนั้น ไม่งั้นหยิบจากคลัง
create function reserve_quota_for_channel(p_channel_id uuid, p_units integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pinned text;
  v_limit integer;
begin
  if not is_service_role() then
    raise exception 'จองโควตาได้จากฝั่ง server เท่านั้น';
  end if;

  select c.quota_project_key into v_pinned
    from channels c where c.id = p_channel_id;

  -- ช่องที่ไม่มีอยู่ต้องฟ้อง ไม่ใช่ตกไปกินโควตาคลังกลางเงียบ ๆ
  -- (ไม่งั้น id ที่พิมพ์ผิดหรือช่องที่ถูกลบแล้วจะเผาโควตาของลูกค้ารายอื่น)
  if not found then
    raise exception 'ไม่พบช่อง %', p_channel_id;
  end if;

  if v_pinned is not null then
    select daily_limit into v_limit from youtube_projects where key = v_pinned;
    -- project ที่ลูกค้าปักหมุดอาจยังไม่ได้ลงทะเบียนในคลัง ใช้เพดานมาตรฐาน
    if reserve_quota(v_pinned, p_units, coalesce(v_limit, 10000)) then
      return v_pinned;
    end if;
    return null;
  end if;

  return reserve_quota_from_pool(p_units);
end;
$$;

revoke execute on function reserve_quota_from_pool(integer) from public;
revoke execute on function reserve_quota_for_channel(uuid, integer) from public;
grant execute on function reserve_quota_from_pool(integer) to service_role;
grant execute on function reserve_quota_for_channel(uuid, integer) to service_role;

-- ── ผู้ใช้ใหม่สร้างองค์กรของตัวเอง ────────────────────────────────────────
-- ต้องเป็น rpc เพราะ policy ของ organizations ให้เห็นเฉพาะองค์กรที่ตัวเองเป็นสมาชิก
-- ผู้ใช้จึง insert ตรง ๆ ไม่ได้ (with check จะไม่ผ่านเพราะยังไม่มีแถวใน org_members)
create function create_org(p_name text, p_slug text, p_starting_credits integer default 0)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_org organizations;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;

  if p_starting_credits <> 0 and not is_service_role() then
    raise exception 'ตั้งเครดิตเริ่มต้นได้จากฝั่ง server เท่านั้น';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'ต้องตั้งชื่อองค์กร';
  end if;

  -- slug ใช้เป็น subdomain/URL ในอนาคต จึงจำกัดอักขระไว้ตั้งแต่ต้น
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'slug ต้องเป็น a-z 0-9 และ - ยาว 3–40 ตัว ขึ้นและลงท้ายด้วยตัวอักษรหรือตัวเลข';
  end if;

  insert into organizations (name, slug, credits)
  values (trim(p_name), p_slug, p_starting_credits)
  returning * into v_org;

  insert into org_members (org_id, user_id, role) values (v_org.id, v_user, 'owner');

  return v_org;
end;
$$;

-- ผู้ใช้ที่ล็อกอินแล้วเรียกได้ (ตรวจ auth.uid() ในตัวฟังก์ชันแล้ว)
revoke execute on function create_org(text, text, integer) from public;
grant execute on function create_org(text, text, integer) to authenticated, service_role;
