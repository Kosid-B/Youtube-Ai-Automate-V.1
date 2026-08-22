-- ที่เก็บภาพที่ AI วาด
--
-- ทำไมต้องเก็บ ไม่ปล่อยให้สร้างใหม่ตอน retry:
--
-- 1. เสียเงินซ้ำ — งานเรนเดอร์ retry ได้ถึง 3 ครั้ง ภาพ 45 ใบต่อคลิป
--    หมายถึงจ่ายค่าสร้างภาพได้ถึง 3 รอบสำหรับคลิปเดียว
-- 2. ได้ภาพคนละใบ — โมเดลสร้างภาพไม่ deterministic สั่ง prompt เดิมได้ภาพใหม่เสมอ
--    retry แล้วจะได้คลิปที่ภาพไม่เหมือนรอบก่อน ซึ่งทำให้ไล่ปัญหาไม่ได้เลย
--    (ต่างจาก Pexels ที่ provider_id เดิมได้ภาพเดิมเสมอ)
--
-- โครงพาธ: <org_id>/<video_id>/<scene_index>.png

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-images', 'generated-images', false, 33554432, array['image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "org members read own generated images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'generated-images'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );
