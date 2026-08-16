-- องค์กร สมาชิก และ helper สำหรับ RLS
-- helper ทุกตัวเป็น security definer + set search_path = public
-- เพื่อให้ policy เรียกได้โดยไม่วน RLS กลับมาที่ org_members

create extension if not exists pgcrypto;

create type org_role as enum ('owner', 'admin', 'editor', 'viewer');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  -- เครดิตคงเหลือ ตัดผ่าน rpc consume_credits เท่านั้น (ห้าม update ตรง ๆ)
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on org_members (user_id);

-- ── helper ────────────────────────────────────────────────────────────────
-- security definer = ข้าม RLS ของ org_members ทำให้ policy ที่เรียก helper
-- ไม่วนกลับมาเช็ค policy ของ org_members อีกรอบ
create function is_org_member(p_org_id uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from org_members m
     where m.org_id = p_org_id
       and m.user_id = (select auth.uid())
  );
$$;

create function has_org_role(p_org_id uuid, p_roles org_role[]) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from org_members m
     where m.org_id = p_org_id
       and m.user_id = (select auth.uid())
       and m.role = any (p_roles)
  );
$$;

-- ผู้เรียกที่เป็น service role ข้ามการตรวจสมาชิกได้ (worker / route handler)
create function is_service_role() returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or coalesce((current_setting('request.jwt.claims', true))::jsonb ->> 'role', '') = 'service_role';
$$;

-- ต้อง revoke จาก public ด้วย ไม่ใช่แค่ anon/authenticated
-- เพราะ Postgres ให้ EXECUTE กับ PUBLIC เป็นค่าเริ่มต้นของทุกฟังก์ชัน
revoke execute on function is_service_role() from public;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table organizations enable row level security;
alter table org_members enable row level security;

create policy organizations_select on organizations
  for select to authenticated
  using (is_org_member(id));

-- แก้ชื่อ/สลัก ได้เฉพาะ owner/admin · คอลัมน์ credits คุมด้วย trigger ด้านล่าง
create policy organizations_update on organizations
  for update to authenticated
  using (has_org_role(id, array['owner', 'admin']::org_role[]))
  with check (has_org_role(id, array['owner', 'admin']::org_role[]));

create policy org_members_select on org_members
  for select to authenticated
  using (is_org_member(org_id));

create policy org_members_write on org_members
  for all to authenticated
  using (has_org_role(org_id, array['owner', 'admin']::org_role[]))
  with check (has_org_role(org_id, array['owner', 'admin']::org_role[]));

-- กันการแก้ credits ผ่าน update ตรง ๆ แม้ผู้ใช้จะเป็น owner หรือ service role
-- ทางเดียวที่แก้ได้คือ rpc consume_credits / grant_credits ซึ่งจะตั้งธง
-- app.credits_rpc ไว้ชั่วคราวภายใน transaction ของตัวเองก่อน update
create function guard_org_credits() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.credits is distinct from old.credits
     and coalesce(current_setting('app.credits_rpc', true), '') <> 'on' then
    raise exception 'ห้ามแก้ credits ตรง ๆ ให้ใช้ rpc consume_credits หรือ grant_credits';
  end if;
  return new;
end;
$$;

create trigger organizations_guard_credits
  before update on organizations
  for each row execute function guard_org_credits();
