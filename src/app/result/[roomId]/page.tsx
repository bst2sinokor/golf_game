'use client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom } from '@/lib/roomStore'
import type { Room } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'
import { calcAllResults } from '@/lib/gameLogic'

export default function ResultPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom] = useState<Room | null>(null)
  const [myId, setMyId] = useState('')

  useEffect(() => {
    setMyId(localStorage.getItem('golf_player') ?? '')
    const unsub = subscribeRoom(roomId, r => setRoom(r))
    return unsub
  }, [roomId])

  if (!room) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>로딩 중...</div>
  if (room.status === 'playing') { router.push(`/play/${roomId}`); return null }

  const players  = Object.values(room.players)
  const results  = calcAllResults(room)
  const { playerTotals, settlements, holeResults, sinperioDeltas } = results

  // 홀별 스코어표
  const holeSummary = Array.from({ length: 18 }, (_, i) => i + 1).map(h => ({
    h,
    par: room.config.holePars[h - 1] ?? 4,
    scores: players.map(p => room.holes[h]?.scores?.[p.id] ?? '-'),
  }))

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 48 }}>🏆</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>최종 정산</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>방 코드: {roomId}</p>
      </div>

      {/* 최종 손익 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 12, fontSize: 16 }}>인원별 최종 손익</p>
        {players
          .sort((a, b) => (playerTotals[b.id]?.net ?? 0) - (playerTotals[a.id]?.net ?? 0))
          .map((p, rank) => {
            const t = playerTotals[p.id]
            const net = t?.net ?? 0
            const isMe = p.id === myId
            return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                background: isMe ? 'rgba(59,130,246,.12)' : 'rgba(255,255,255,.03)',
                border: isMe ? '1px solid rgba(59,130,246,.3)' : '1px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, minWidth: 28 }}>
                    {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '  '}
                  </span>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{p.name}{isMe ? ' (나)' : ''}</span>
                    {t?.isOecd && <span className="tag-red" style={{ marginLeft: 6 }}>OECD</span>}
                    {t?.oecdPenalty > 0 && (
                      <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>
                        페널티 −{t.oecdPenalty.toLocaleString()}원
                      </p>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 800, fontSize: 20, color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {net >= 0 ? '+' : ''}{net.toLocaleString()}원
                  </p>
                  {p.initialAmount > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                      최종 {(p.initialAmount + net).toLocaleString()}원
                    </p>
                  )}
                </div>
              </div>
            )
          })}
      </div>

      {/* 정산 방법 */}
      {settlements.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 700, marginBottom: 12 }}>💸 정산 방법</p>
          {settlements.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 8, marginBottom: 6,
              background: 'rgba(255,255,255,.03)',
            }}>
              <span style={{ fontSize: 15 }}>
                <span style={{ fontWeight: 700, color: '#f87171' }}>{s.from}</span>
                <span style={{ color: 'var(--muted)' }}> → </span>
                <span style={{ fontWeight: 700, color: '#4ade80' }}>{s.to}</span>
              </span>
              <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--yellow)' }}>
                {s.amount.toLocaleString()}원
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 신페리오 상세 */}
      {Object.keys(sinperioDeltas).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>신페리오 핸디캡</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            선정 홀: {room.sinperioHoles.join(', ')}홀
          </p>
          {players.map(p => {
            const d = sinperioDeltas[p.id] ?? 0
            return (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontWeight: 700, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {d >= 0 ? '+' : ''}{d.toLocaleString()}원
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* 홀별 스코어 */}
      <div className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
        <p style={{ fontWeight: 700, marginBottom: 10 }}>홀별 스코어</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: 'var(--muted)', padding: '4px 6px' }}>홀</th>
              <th style={{ color: 'var(--muted)', padding: '4px 6px' }}>파</th>
              {players.map(p => (
                <th key={p.id} style={{ color: 'var(--muted)', padding: '4px 6px' }}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holeSummary.map(({ h, par, scores }) => {
              const minScore = scores.filter((s): s is number => typeof s === 'number').reduce((m, s) => Math.min(m, s), 99)
              return (
                <tr key={h} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px', fontWeight: 700 }}>{h}</td>
                  <td style={{ textAlign: 'center', padding: '6px', color: 'var(--muted)' }}>{par}</td>
                  {scores.map((s, i) => {
                    const diff = typeof s === 'number' ? s - par : null
                    const isMin = typeof s === 'number' && s === minScore
                    return (
                      <td key={i} style={{
                        textAlign: 'center', padding: '6px', fontWeight: isMin ? 800 : 600,
                        color: diff === null ? 'var(--muted)' : diff < 0 ? '#4ade80' : diff === 0 ? 'var(--text)' : diff === 1 ? '#fbbf24' : '#f87171',
                      }}>{s}</td>
                    )
                  })}
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
              <td style={{ padding: '8px 6px', fontWeight: 800 }}>합계</td>
              <td style={{ textAlign: 'center', padding: '8px 6px', color: 'var(--muted)' }}>
                {room.config.holePars.reduce((s, p) => s + p, 0)}
              </td>
              {players.map(p => {
                const total = Array.from({ length: 18 }, (_, i) => i + 1)
                  .reduce((s, h) => s + (room.holes[h]?.scores?.[p.id] ?? 0), 0)
                const coursePar = room.config.holePars.reduce((s, par) => s + par, 0)
                const diff = total - coursePar
                return (
                  <td key={p.id} style={{
                    textAlign: 'center', padding: '8px 6px', fontWeight: 800,
                    color: diff < 0 ? '#4ade80' : diff === 0 ? 'var(--text)' : '#f87171',
                  }}>
                    {total} ({diff >= 0 ? '+' : ''}{diff})
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* 홀별 게임 결과 요약 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 10 }}>게임별 홀 결과</p>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hr = holeResults[h]
          if (!hr || hr.length === 0) return null
          const relevantResults = hr.filter(r => r.game !== 'sinperio')
          if (relevantResults.length === 0) return null
          return (
            <div key={h} style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{h}홀</p>
              {relevantResults.map((r, i) => (
                <div key={i} style={{ fontSize: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)', marginBottom: 3 }}>
                  <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{GAME_LABELS[r.game]}</span>
                  <span style={{ color: 'var(--muted)' }}> · </span>
                  {r.detail}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <button className="btn btn-gray" onClick={() => router.push('/')}>
        🏠 홈으로
      </button>
    </div>
  )
}
