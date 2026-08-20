-- สัญญาณชีพของงานที่รันนาน
--
-- pipeline_stuck_jobs ถือว่างานสถานะ claimed ที่ค้างเกิน 30 นาที = worker ตาย
-- แล้วเสนอปุ่ม "เอากลับเข้าคิว" ให้ผู้ใช้กด
--
-- กติกานั้นถูกต้องตอนที่งานที่ยาวที่สุดคือคลิป 8 นาที แต่พังทันทีที่มีคลิปยาวพิเศษ:
-- เรนเดอร์ 45 นาทีใช้เวลาเกิน 30 นาทีตามปกติ ผู้ใช้จะเห็นงานที่กำลังทำงานอยู่ดี ๆ
-- ถูกติดป้ายว่า worker ตาย แล้วกด requeue → ได้เรนเดอร์ซ้อนสองรอบ เสียเงินสองเท่า
-- และคลิปเดียวกันถูกเขียนทับกลางคัน
--
-- heartbeat_job เลื่อน claimed_at ทุกครั้งที่เรนเดอร์จบไปหนึ่งช่วง (ราว 6 นาที)
-- กติกา 30 นาทีจึงกลายเป็น "ไม่มีสัญญาณชีพ 30 นาที" ซึ่งเป็นสิ่งที่ตั้งใจวัดจริง ๆ

create function heartbeat_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- คิวงานเป็นของ worker เท่านั้น เหมือน claim_job
  if not is_service_role() then
    raise exception 'ส่งสัญญาณชีพได้จากฝั่ง server เท่านั้น';
  end if;

  -- เฉพาะงานที่ยัง claimed อยู่ — งานที่ปิดไปแล้วต้องไม่ถูกปลุกให้ดูเหมือนยังทำงาน
  update jobs
     set claimed_at = now()
   where id = p_job_id
     and status = 'claimed';
end;
$$;

revoke execute on function heartbeat_job(uuid) from public;
revoke execute on function heartbeat_job(uuid) from anon, authenticated;
grant execute on function heartbeat_job(uuid) to service_role;

comment on function heartbeat_job(uuid) is
  'worker เรียกระหว่างงานที่รันนาน เพื่อไม่ให้ถูกเข้าใจผิดว่าตาย (ดู pipeline_stuck_jobs)';
