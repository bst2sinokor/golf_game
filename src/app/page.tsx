'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRoom, joinRoom } from '@/lib/roomStore'

export default function Home() {
  const router = useRouter()
  const [tab, setTab]       = useState<'create' | 'join'>('create')
  const [name, setName]     = useState('')
  const [roomCode, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function handleCreate() {
    if (!name.trim()) return setError('이름을 입력하세요.')
    setLoading(true); setError('')
    try {
      const { roomId, playerId } = await createRoom(name.trim())
      localStorage.setItem('golf_room',   roomId)
      localStorage.setItem('golf_player', playerId)
      router.push(`/setup/${roomId}`)
    } catch {
      setError('방 만들기 실패. 다시 시도해주세요.')
    } finally { setLoading(false) }
  }

  async function handleJoin() {
    if (!name.trim())     return setError('이름을 입력하세요.')
    if (!roomCode.trim()) return setError('방 코드를 입력하세요.')
    setLoading(true); setError('')
    try {
      const result = await joinRoom(roomCode.trim().toUpperCase(), name.trim())
      if ('error' in result) { setError(result.error); setLoading(false); return }
      localStorage.setItem('golf_room',   roomCode.trim().toUpperCase())
      localStorage.setItem('golf_player', result.playerId)
      router.push(`/play/${roomCode.trim().toUpperCase()}`)
    } catch {
      setError('참가 실패. 다시 시도해주세요.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* 헤더 */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⛳</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>모두의 골프게임</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>실시간 골프 내기 자동 정산</p>
        </div>

        {/* 탭 */}
        <div style={{ display: 'flex', background: 'var(--card)', borderRadius: 10, padding: 4, marginBottom: 24, border: '1px solid var(--border)' }}>
          {(['create', 'join'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError('') }}
              style={{
                flex: 1, padding: '10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 15, fontWeight: 600,
                background: tab === t ? 'var(--green)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--muted)',
                transition: 'all .15s',
              }}>
              {t === 'create' ? '🏌️ 방 만들기' : '🙋 방 참가하기'}
            </button>
          ))}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'join' && (
            <div>
              <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>방 코드</label>
              <input
                type="text"
                placeholder="예: AB3K"
                value={roomCode}
                onChange={e => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                style={{ textTransform: 'uppercase', letterSpacing: 4, fontSize: 22, textAlign: 'center', fontWeight: 700 }}
              />
            </div>
          )}
          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              {tab === 'create' ? '진행자 이름' : '내 이름'}
            </label>
            <input
              type="text"
              placeholder="이름 입력"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center' }}>{error}</p>
          )}

          <button
            className={`btn ${tab === 'create' ? 'btn-green' : 'btn-blue'}`}
            onClick={tab === 'create' ? handleCreate : handleJoin}
            disabled={loading}
            style={{ marginTop: 4 }}
          >
            {loading ? '처리 중...' : tab === 'create' ? '방 만들기' : '참가하기'}
          </button>
        </div>

        <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
          진행자가 방을 만들고 방 코드를 공유하면<br />
          동반자들이 각자 폰에서 참가합니다.
        </p>
      </div>
    </div>
  )
}
