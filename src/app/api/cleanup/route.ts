import { NextResponse } from 'next/server'
import { collection, query, where, getDocs, deleteDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

// 매일 KST 23:59에 Vercel Cron이 호출 (vercel.json: "59 14 * * *" = 14:59 UTC)
// 생성일이 '오늘(KST) 0시' 이전인 방을 삭제 → 방 만든 날을 D-day로 보면 D+1일 23:59에 삭제.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // CRON_SECRET이 설정돼 있으면 Vercel Cron 요청(Authorization: Bearer ...)만 허용
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  // KST(UTC+9) 기준 오늘 0시의 절대 epoch(ms)
  const KST = 9 * 60 * 60 * 1000
  const kst = new Date(Date.now() + KST)
  const startOfTodayKST = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST

  try {
    const q = query(collection(db, 'rooms'), where('createdAt', '<', startOfTodayKST))
    const snap = await getDocs(q)
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
    return NextResponse.json({ deleted: snap.size, cutoff: startOfTodayKST })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
