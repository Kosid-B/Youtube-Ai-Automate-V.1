-- ตรวจ RLS ของตารางสายงานคลิปโฆษณาด้วยผู้ใช้จริงสองคน คนละองค์กร
--
-- ทำไมต้องมีไฟล์นี้: การดูว่า "มี policy อยู่" ไม่ได้พิสูจน์ว่า "มันกัน"
-- policy ที่เขียน USING ไว้แต่ลืม WITH CHECK จะดูครบดีในตาราง pg_policy
-- แต่ยอมให้ย้ายแถวข้ามองค์กรได้ · ต้องลองแตะจริงเท่านั้นถึงจะรู้
--
-- รันด้วยสิทธิ์ service role / postgres:
--   psql "$DATABASE_URL" -f supabase/tests/video_rls_verification.sql
-- หรือวางลง SQL Editor ของ Supabase
--
-- สร้างผู้ใช้กับองค์กรชั่วคราว ตรวจ แล้วลบทิ้งทั้งหมดในตัวเอง

create temp table if not exists _rls_check (step text, expected text, actual text);

do $$
declare
  org_a uuid; org_b uuid;
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  proj_a uuid;
  n int;
  ok boolean;
begin
  delete from _rls_check;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rls-a@test.local', '', now(), now(), now()),
         (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rls-b@test.local', '', now(), now(), now());

  insert into organizations (name, slug) values ('RLS org A', 'rls-org-a') returning id into org_a;
  insert into organizations (name, slug) values ('RLS org B', 'rls-org-b') returning id into org_b;
  insert into org_members (org_id, user_id, role) values (org_a, user_a, 'owner');
  insert into org_members (org_id, user_id, role) values (org_b, user_b, 'owner');
  insert into video_projects (org_id, created_by, title)
    values (org_a, user_a, 'ของ org A') returning id into proj_a;

  -- สวมบทเป็นผู้ใช้ของ org B ผ่าน JWT claim จริง ไม่ใช่ตัวแปรที่เราตั้งเอง
  -- (is_org_member อ่าน auth.uid() จาก claim นี้ ซึ่งเป็นทางเดียวกับที่แอปจริงใช้)
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b::text, 'role', 'authenticated')::text, true);

  select count(*) into n from video_projects where id = proj_a;
  insert into _rls_check values ('SELECT ข้ามองค์กร', '0 แถว', n || ' แถว');

  update video_projects set title = 'โดนแก้' where id = proj_a;
  get diagnostics n = row_count;
  insert into _rls_check values ('UPDATE ข้ามองค์กร', '0 แถว', n || ' แถว');

  delete from video_projects where id = proj_a;
  get diagnostics n = row_count;
  insert into _rls_check values ('DELETE ข้ามองค์กร', '0 แถว', n || ' แถว');

  -- ข้อนี้คือข้อที่ WITH CHECK มีไว้กัน — ยัดแถวใหม่เข้าองค์กรที่ตัวเองไม่ได้เป็นสมาชิก
  ok := false;
  begin
    insert into video_projects (org_id, created_by, title) values (org_a, user_b, 'ยัดข้ามองค์กร');
  exception when insufficient_privilege then ok := true;
  end;
  insert into _rls_check values ('INSERT ยัดเข้าองค์กรอื่น', 'ถูกบล็อก',
    case when ok then 'ถูกบล็อก' else 'หลุด' end);

  select count(*) into n from video_generations where org_id = org_a;
  insert into _rls_check values ('SELECT video_generations ข้ามองค์กร', '0 แถว', n || ' แถว');

  -- และต้องไม่กันเกินจนเจ้าของเองก็เข้าไม่ได้
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text, true);
  select count(*) into n from video_projects where id = proj_a;
  insert into _rls_check values ('เจ้าของเห็นของตัวเอง', '1 แถว', n || ' แถว');

  reset role;
  delete from organizations where id in (org_a, org_b);
  delete from auth.users where id in (user_a, user_b);
end $$;

select step, expected, actual,
       case when expected = actual then 'ผ่าน' else 'ไม่ผ่าน' end as result
from _rls_check;
