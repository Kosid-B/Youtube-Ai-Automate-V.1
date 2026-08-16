-- ที่เก็บไฟล์คลิปที่ประกอบเสร็จแล้ว
--
-- ตั้งเป็น bucket ส่วนตัว (public = false) เพราะคลิปยังไม่เผยแพร่
-- worker ใช้ service role เขียนได้อยู่แล้ว · ฝั่งผู้ใช้ดูผ่าน signed URL เท่านั้น

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 2147483648, array['video/mp4'])
on conflict (id) do nothing;

-- สมาชิกองค์กรอ่านไฟล์ของคลิปตัวเองได้ ผ่านพาธที่ขึ้นต้นด้วย org_id
-- โครงพาธ: <org_id>/<video_id>.mp4
create policy "org members read own videos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'videos'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );
