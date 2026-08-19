-- เก็บ refresh token ของ YouTube ไว้ใน Supabase Vault
--
-- ห้ามเก็บเป็น plaintext ในตารางเด็ดขาด — token ตัวนี้ให้สิทธิ์อัปคลิปขึ้นช่องของผู้ใช้
-- ใครอ่านได้ก็โพสต์ในนามเขาได้ · channels.oauth_secret_id เก็บแค่ "รหัสอ้างอิง"
-- ตัวความลับจริงอยู่ใน vault ซึ่งเข้ารหัสไว้และไม่โผล่ใน backup ปกติ

-- ── บันทึก token หลังผู้ใช้กดอนุญาต ─────────────────────────────────
create function store_channel_oauth(p_channel_id uuid, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_org uuid;
  v_old uuid;
  v_new uuid;
begin
  select org_id, oauth_secret_id into v_org, v_old
    from channels where id = p_channel_id;

  if not found then
    raise exception 'ไม่พบช่อง %', p_channel_id;
  end if;

  if not has_org_role (v_org, array['owner', 'admin']::org_role[]) then
    raise exception 'ต้องเป็นเจ้าของหรือแอดมินขององค์กรจึงจะเชื่อมช่องได้';
  end if;

  if coalesce(trim(p_refresh_token), '') = '' then
    raise exception 'refresh token ว่าง';
  end if;

  -- ชื่อ secret ต้องไม่ซ้ำ · เคยใช้ epoch วินาทีแล้วชนกันเมื่อเชื่อมซ้ำภายในวินาทีเดียว
  -- (กดปุ่มสองครั้ง หรือ retry) — uuid ไม่มีทางชนไม่ว่าเรียกถี่แค่ไหน
  -- เวลาที่เชื่อมไปอยู่ใน description แทน ซึ่งไม่ต้องไม่ซ้ำ
  v_new := vault.create_secret(
    p_refresh_token,
    'youtube_refresh_' || p_channel_id || '_' || gen_random_uuid(),
    'YouTube refresh token ของช่อง ' || p_channel_id || ' · เชื่อมเมื่อ ' || now()
  );

  update channels set oauth_secret_id = v_new where id = p_channel_id;

  -- ลบตัวเก่าหลังผูกตัวใหม่สำเร็จแล้วเท่านั้น
  -- ลบก่อนแล้วขั้นตอนถัดไปล้ม = ช่องจะไม่มี token ทั้งเก่าและใหม่
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
end;
$$;

revoke execute on function store_channel_oauth (uuid, text) from public;
grant execute on function store_channel_oauth (uuid, text) to service_role;

-- ── อ่าน token ออกมาใช้ ──────────────────────────────────────────────
--
-- ⚠️ service_role เท่านั้น ห้าม grant ให้ authenticated เด็ดขาด
-- ผู้ใช้ที่ล็อกอินอยู่ไม่มีเหตุผลต้องเห็น token ดิบ — worker เป็นตัวเดียวที่ต้องใช้
create function channel_refresh_token(p_channel_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret uuid;
  v_token text;
begin
  if not is_service_role() then
    raise exception 'อ่าน token ได้จากฝั่ง server เท่านั้น';
  end if;

  select oauth_secret_id into v_secret from channels where id = p_channel_id;

  if v_secret is null then
    raise exception 'ช่อง % ยังไม่ได้เชื่อมกับ YouTube', p_channel_id;
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where id = v_secret;

  if v_token is null then
    raise exception 'ไม่พบ token ของช่อง % ใน vault (secret ถูกลบไปแล้ว?)', p_channel_id;
  end if;

  return v_token;
end;
$$;

revoke execute on function channel_refresh_token (uuid) from public;
grant execute on function channel_refresh_token (uuid) to service_role;

-- ── ถอนการเชื่อมต่อ ──────────────────────────────────────────────────
create function disconnect_channel_oauth(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_org uuid;
  v_secret uuid;
begin
  select org_id, oauth_secret_id into v_org, v_secret
    from channels where id = p_channel_id;

  if not found then
    raise exception 'ไม่พบช่อง %', p_channel_id;
  end if;

  if not has_org_role (v_org, array['owner', 'admin']::org_role[]) then
    raise exception 'ต้องเป็นเจ้าของหรือแอดมินขององค์กร';
  end if;

  update channels set oauth_secret_id = null where id = p_channel_id;

  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke execute on function disconnect_channel_oauth (uuid) from public;
grant execute on function disconnect_channel_oauth (uuid) to authenticated, service_role;

-- ── ดูว่าช่องไหนเชื่อมแล้วบ้าง (ไม่เปิดเผยตัว token) ─────────────────
create function channel_oauth_status(p_org_id uuid)
returns table (channel_id uuid, channel_name text, connected boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_member(p_org_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงองค์กรนี้';
  end if;

  return query
  select c.id, c.name, c.oauth_secret_id is not null
  from channels c where c.org_id = p_org_id order by c.created_at;
end;
$$;

revoke execute on function channel_oauth_status (uuid) from public;
grant execute on function channel_oauth_status (uuid) to authenticated, service_role;
