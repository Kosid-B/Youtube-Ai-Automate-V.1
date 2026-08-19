'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type IdeaState = { error: string | null }

/** ทิ้งหัวข้อที่ไม่เอา — ไม่งั้นรายการจะบวมจนหาของดีไม่เจอ */
export async function dropIdea(_prev: IdeaState, formData: FormData): Promise<IdeaState> {
  const id = String(formData.get('ideaId') ?? '')
  if (!id) return { error: 'ไม่มีรหัสหัวข้อ' }

  const supabase = await createClient()
  const { error } = await supabase.from('ideas').delete().eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/ideas')
  return { error: null }
}
