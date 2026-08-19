-- รูปแบบคลิป: ยาว (16:9) หรือ สั้น (9:16)
--
-- เก็บที่สคริปต์ด้วย ไม่ใช่แค่ที่คลิป เพราะรูปแบบกำหนดตั้งแต่ตอนเขียน —
-- สคริปต์ 6,700 ตัวอักษรทำเป็นคลิปสั้นไม่ได้ ต้องรู้ก่อนเรียกโมเดล

create type video_format as enum ('long', 'short');

alter table scripts add column format video_format not null default 'long';
alter table videos  add column format video_format not null default 'long';

comment on column scripts.format is
  'กำหนดความยาวสคริปต์ที่ขอจากโมเดล — สั้น ~700 ตัวอักษร · ยาว ~6,700';
comment on column videos.format is
  'กำหนดขนาดเฟรม แนวภาพที่ขอจาก Pexels และขนาด/ตำแหน่งซับ';

-- ดูผลงานแยกตามรูปแบบ — คลิปสั้นกับยาวเทียบยอดวิวกันตรง ๆ ไม่ได้
-- การกระจายของ Shorts คนละกลไกกับคลิปยาว เอามารวมกันแล้วสรุปจะผิด
create index videos_format_idx on videos (org_id, format);
