-- ข้อความชวนคลิก + ลิงก์ ต่อท้ายคำอธิบายทุกคลิปของช่อง
--
-- ก่อนหน้านี้คำอธิบายมีแค่เครดิตช่างภาพ — คลิปที่ปล่อยออกไปไม่มีอะไรพาคนดู
-- ไปที่ไหนได้เลย ซึ่งทำให้เหตุผลของการทำคลิปเพื่อการตลาดหายไปทั้งหมด
--
-- เก็บที่ช่อง ไม่ใช่ที่คลิป เพราะปลายทางเป็นของช่อง ไม่ได้เปลี่ยนรายคลิป
-- และไม่ต้องพิมพ์ซ้ำทุกครั้งที่ผลิต

alter table channels add column cta_template text;

comment on column channels.cta_template is
  'ข้อความ + ลิงก์ที่ต่อไว้บนสุดของคำอธิบายทุกคลิป — ต้องอยู่บนสุดเพราะ YouTube ตัดคำอธิบายเหลือ 2–3 บรรทัดแรก';

-- ── แก้ข้อความชวนคลิก ────────────────────────────────────────────────
create function set_channel_cta(p_channel_id uuid, p_cta text)
returns channels
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  result channels;
begin
  select org_id into v_org from channels where id = p_channel_id;

  if not found then
    raise exception 'ไม่พบช่อง %', p_channel_id;
  end if;

  if not has_org_role (v_org, array['owner', 'admin', 'editor']::org_role[]) then
    raise exception 'ไม่มีสิทธิ์แก้ช่องนี้';
  end if;

  if length(coalesce(p_cta, '')) > 1000 then
    raise exception 'ข้อความชวนคลิกยาวเกิน 1000 ตัวอักษร';
  end if;

  -- ว่าง = ลบทิ้ง ไม่ใช่เก็บสตริงว่างไว้ให้ต้องมาเช็คสองแบบทีหลัง
  update channels
  set cta_template = nullif(trim(coalesce(p_cta, '')), '')
  where id = p_channel_id
  returning * into result;

  return result;
end;
$$;

revoke execute on function set_channel_cta (uuid, text) from anon, public;
grant execute on function set_channel_cta (uuid, text) to authenticated, service_role;

-- ── อ่านข้อความชวนคลิกพร้อมสถานะการเชื่อมต่อ (แทนตัวเดิม) ────────────
--
-- ต้อง drop ก่อน — create or replace เปลี่ยนชุดคอลัมน์ที่คืนไม่ได้
-- ('cannot change return type of existing function') และเราเพิ่มคอลัมน์ cta เข้าไป
drop function if exists channel_oauth_status (uuid);

create function channel_oauth_status(p_org_id uuid)
returns table (channel_id uuid, channel_name text, connected boolean, cta text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  return query
  select c.id, c.name, c.oauth_secret_id is not null, c.cta_template
  from channels c where c.org_id = p_org_id order by c.created_at;
end;
$$;

revoke execute on function channel_oauth_status (uuid) from anon, public;
grant execute on function channel_oauth_status (uuid) to authenticated, service_role;
