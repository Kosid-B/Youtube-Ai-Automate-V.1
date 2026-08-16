/**
 * ชนิดข้อมูลของ schema — ไฟล์นี้เขียนมือไว้ก่อนเพื่อให้ typecheck ผ่านตั้งแต่ยังไม่ได้ลิงก์ Supabase
 * เมื่อ `supabase link` แล้ว ให้ทับด้วยของจริง: `pnpm db:types` (แล้ว commit ไปด้วย)
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type ScriptStatus = 'draft' | 'checking' | 'ready' | 'blocked'
export type VideoStatus =
  | 'queued'
  | 'rendering'
  | 'ready'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'blocked'
export type JobStatus = 'queued' | 'claimed' | 'done' | 'failed' | 'dead'

export type JobKind = 'script_generate' | 'video_render' | 'youtube_upload' | 'metrics_sync'

export type OrganizationRow = {
  id: string
  name: string
  slug: string
  credits: number
  created_at: string
}

export type OrgMemberRow = {
  org_id: string
  user_id: string
  role: OrgRole
  created_at: string
}

export type ChannelRow = {
  id: string
  org_id: string
  name: string
  niche: string | null
  youtube_channel_id: string | null
  oauth_secret_id: string | null
  /** null = ให้ระบบเลือก project จากคลังให้ · มีค่า = ลูกค้าปักหมุดเอง (BYO) */
  quota_project_key: string | null
  created_at: string
}

export type IdeaRow = {
  id: string
  org_id: string
  channel_id: string
  title: string
  angle: string | null
  source_note: string | null
  score: number | null
  created_at: string
}

export type ScriptRow = {
  id: string
  org_id: string
  channel_id: string
  idea_id: string | null
  title: string
  body: string | null
  status: ScriptStatus
  originality: Json | null
  created_at: string
  updated_at: string
}

export type VideoRow = {
  id: string
  org_id: string
  channel_id: string
  script_id: string
  title: string
  description: string | null
  status: VideoStatus
  storage_path: string | null
  youtube_video_id: string | null
  publish_at: string | null
  published_at: string | null
  block_reason: string | null
  created_at: string
  updated_at: string
}

export type VideoMetricRow = {
  id: string
  org_id: string
  video_id: string
  day: string
  views: number
  ctr: number | null
  avd_seconds: number | null
  rpm: number | null
  synced_at: string
}

export type JobRow = {
  id: string
  org_id: string
  kind: JobKind
  payload: Json
  status: JobStatus
  attempts: number
  max_attempts: number
  run_after: string
  claimed_at: string | null
  claimed_by: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type YoutubeProjectRow = {
  key: string
  label: string
  daily_limit: number
  enabled: boolean
  created_at: string
}

export type VideoAssetRow = {
  id: string
  org_id: string
  video_id: string
  scene_index: number
  provider: string
  provider_id: string
  photographer: string
  photographer_url: string | null
  source_url: string
  storage_path: string | null
  query: string | null
  created_at: string
}

export type CreditLedgerRow = {
  id: string
  org_id: string
  delta: number
  balance_after: number
  reason: string
  ref_id: string | null
  created_at: string
}

type TableShape<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      organizations: TableShape<OrganizationRow>
      org_members: TableShape<OrgMemberRow>
      channels: TableShape<ChannelRow>
      ideas: TableShape<IdeaRow>
      scripts: TableShape<ScriptRow>
      videos: TableShape<VideoRow>
      video_metrics: TableShape<VideoMetricRow>
      jobs: TableShape<JobRow>
      credit_ledger: TableShape<CreditLedgerRow>
      youtube_projects: TableShape<YoutubeProjectRow>
      video_assets: TableShape<VideoAssetRow>
    }
    Views: Record<string, never>
    Functions: {
      claim_job: {
        Args: { p_worker_id: string; p_kinds?: string[] | null }
        Returns: JobRow | null
      }
      complete_job: {
        Args: { p_job_id: string; p_ok: boolean; p_error?: string | null }
        Returns: JobRow
      }
      defer_job: {
        Args: { p_job_id: string; p_run_after: string; p_reason?: string | null }
        Returns: JobRow
      }
      enqueue_job: {
        Args: {
          p_org_id: string
          p_kind: string
          p_payload?: Record<string, unknown>
          p_cost?: number
          p_run_after?: string
        }
        Returns: JobRow
      }
      consume_credits: {
        Args: { p_org_id: string; p_amount: number; p_reason: string; p_ref_id?: string | null }
        Returns: number
      }
      grant_credits: {
        Args: { p_org_id: string; p_amount: number; p_reason: string; p_ref_id?: string | null }
        Returns: number
      }
      reserve_quota: {
        Args: { p_project_key: string; p_units: number; p_daily_limit?: number }
        Returns: boolean
      }
      release_quota: {
        Args: { p_project_key: string; p_units: number }
        Returns: undefined
      }
      reserve_quota_for_channel: {
        Args: { p_channel_id: string; p_units: number }
        Returns: string | null
      }
      reserve_quota_from_pool: {
        Args: { p_units: number }
        Returns: string | null
      }
      create_org: {
        Args: { p_name: string; p_slug: string; p_starting_credits?: number }
        Returns: OrganizationRow
      }
      quota_resets_at: {
        Args: Record<string, never>
        Returns: string
      }
    }
    Enums: {
      org_role: OrgRole
      script_status: ScriptStatus
      video_status: VideoStatus
      job_status: JobStatus
    }
    CompositeTypes: Record<string, never>
  }
}
