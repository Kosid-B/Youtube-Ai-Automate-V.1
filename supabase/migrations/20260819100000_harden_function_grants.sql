-- ปิดช่องที่ anon เรียกฟังก์ชันทั้งหมดได้
--
-- ⚠️ บทเรียน: บน Supabase การเขียน `revoke execute ... from public` ไม่พอ
-- เพราะ Supabase ตั้ง default privileges ไว้ว่าฟังก์ชันใหม่ทุกตัวใน schema public
-- จะได้ EXECUTE ให้ anon / authenticated แบบ "ระบุชื่อ role" ไม่ใช่ผ่าน PUBLIC
-- การ revoke จาก PUBLIC จึงไม่แตะสิทธิ์ชุดนั้นเลย
--
-- ตรวจเจอด้วย database linter ของ Supabase (anon_security_definer_function_executable)
-- ยืนยันด้วย has_function_privilege('anon', oid, 'EXECUTE') = true ทั้ง 22 ตัว
--
-- ผลกระทบจริงถูกจำกัดไว้เพราะเกือบทุกตัวมีด่าน is_service_role() / is_org_member()
-- อยู่ในตัวฟังก์ชัน — ยกเว้น capture_content_features ที่ไม่มีเลย (แก้ข้างล่างด้วย)

-- ── ปิดประตูสำหรับฟังก์ชันใหม่ในอนาคต ────────────────────────────────
-- ไม่ทำข้อนี้ ฟังก์ชันที่เขียนเพิ่มทีหลังจะเปิดให้ anon อีกโดยอัตโนมัติ
-- fail-closed: ลืม grant = แอปเรียกไม่ได้ (เห็นทันที) ดีกว่าลืม revoke = anon เรียกได้ (ไม่มีใครเห็น)
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ── ถอนสิทธิ์ที่ให้ไปแล้วทั้งหมด แล้วค่อยให้ใหม่เท่าที่จำเป็น ─────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      -- ข้ามฟังก์ชันที่มากับ extension (pg_net ฯลฯ) — เราไม่ได้เป็นเจ้าของ
      -- revoke แล้วจะ error 'must be owner' ทำให้ db push ทั้งไฟล์ล้ม
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', r.sig);
  end loop;
end $$;

-- ── ⚠️ ตัวช่วยของ RLS ต้องคงสิทธิ์ไว้ ห้ามถอน ────────────────────────
--
-- policy ของทุกตารางเรียกสามตัวนี้ และ Postgres ประเมิน policy ด้วยสิทธิ์
-- ของ "ผู้เรียก" ไม่ใช่เจ้าของตาราง ถอน EXECUTE ออกเมื่อไร ผู้ใช้ที่ล็อกอิน
-- จะอ่านตารางอะไรไม่ได้เลยทั้งระบบ (ทดสอบแล้ว: permission denied for function has_org_role)
--
-- ปลอดภัยที่จะเปิด: ทั้งสามตัวตอบเรื่องของ "ผู้เรียกเอง" เท่านั้น
-- ไม่เปิดเผยข้อมูลขององค์กรหรือของคนอื่น
grant execute on function is_org_member (uuid) to anon, authenticated, service_role;
grant execute on function has_org_role (uuid, org_role[]) to anon, authenticated, service_role;
grant execute on function is_service_role () to anon, authenticated, service_role;

-- ── ฟังก์ชันที่ผู้ใช้ที่ล็อกอินแล้วต้องเรียกได้จริง ──────────────────
-- แต่ละตัวยังมีด่าน is_org_member / has_org_role ในตัวอีกชั้น
grant execute on function create_org (text, text, integer) to authenticated;
grant execute on function channel_oauth_status (uuid) to authenticated;
grant execute on function disconnect_channel_oauth (uuid) to authenticated;
grant execute on function content_feature_summary (uuid, text) to authenticated;
grant execute on function capture_content_features (uuid) to authenticated;
grant execute on function pipeline_summary (uuid) to authenticated;
grant execute on function pipeline_stuck_jobs (uuid) to authenticated;
grant execute on function pipeline_daily (uuid, integer) to authenticated;
grant execute on function quota_remaining_clips (uuid, integer) to authenticated;
grant execute on function requeue_stuck_job (uuid) to authenticated;

-- ── service_role ใช้ได้ทุกตัว (worker กับ route ฝั่ง server) ──────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ── ใส่ด่านที่ขาดไปใน capture_content_features ───────────────────────
--
-- ตัวเดียวที่ไม่มีด่านเลย — ใครก็เขียนคุณลักษณะทับของคลิปไหนก็ได้
-- ไม่ใช่แค่เรื่องข้อมูลเพี้ยน: ข้อความ error ต่างกันระหว่าง "ไม่พบคลิป" กับสำเร็จ
-- ยังบอกคนนอกได้ด้วยว่า video id ไหนมีอยู่จริง
create or replace function capture_content_features(p_video_id uuid)
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

  -- ตรวจหลังหาแถวเจอ แล้วใช้ข้อความเดียวกับกรณีไม่พบ
  -- เพื่อไม่ให้แยกออกว่า "ไม่มีคลิปนี้" ต่างจาก "มีแต่ไม่ใช่ขององค์กรคุณ"
  if not (is_service_role() or has_org_role (v.org_id, array['owner', 'admin', 'editor']::org_role[])) then
    raise exception 'ไม่พบคลิป %', p_video_id;
  end if;

  insert into content_features (
    org_id, video_id, script_chars, image_count, title_chars,
    title_has_number, title_has_question, published_dow, published_hour
  )
  values (
    v.org_id, v.id, v.body_chars, v.images, length(v.title),
    v.title ~ '[0-9๐-๙]',
    v.title like '%?%' or v.title ~ 'ไหม|หรือ|ทำไม|อะไร|ยังไง',
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

revoke execute on function capture_content_features (uuid) from anon, public;
grant execute on function capture_content_features (uuid) to authenticated, service_role;
