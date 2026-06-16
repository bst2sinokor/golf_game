'use client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom } from '@/lib/roomStore'
import type { Room } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'
import { calcAllResults, orderedPlayerIds } from '@/lib/gameLogic'
import SupportButton from '@/components/SupportButton'

// 결과 문구의 플레이어 ID → 이름 치환
function resolveNames(detail: string, players: Room['players']): string {
  let s = detail
  for (const [id, p] of Object.entries(players)) s = s.split(id).join(p.name)
  return s
}

// 스코어보드와 동일한 4그룹 색상
function scoreColor(diff: number): string {
  if (diff <= -2) return '#1e1b4b'  // 알바트로스·이글
  if (diff <= 0)  return '#16a34a'  // 버디·파
  if (diff <= 2)  return '#ca8a04'  // 보기·더블보기
  return '#dc2626'                  // 트리플 이상·더블파
}

export default function ResultPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom] = useState<Room | null>(null)
  const [myId, setMyId] = useState('')

  useEffect(() => {
    setMyId(
      sessionStorage.getItem('golf_player')
      ?? localStorage.getItem(`golf_player_${roomId}`)
      ?? ''
    )
    const unsub = subscribeRoom(roomId, r => setRoom(r))
    return unsub
  }, [roomId])

  if (!room) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>로딩 중...</div>
  if (room.status === 'playing') { router.push(`/play/${roomId}`); return null }

  const players  = orderedPlayerIds(room).map(id => room.players[id]).filter(Boolean)
  const results  = calcAllResults(room)
  const { playerTotals, holeResults, sinperioDeltas, sinperioNetScores, sinperioGross, sinperioHandicaps, sinperioTransfers, buddyResults, oecdResults, eventResults } = results

  // ── 스코어보드 (플레이 화면과 동일 형식, 조회 전용) ──
  const relStr = (score: number, par: number) => {
    const d = score - par
    return d === 0 ? '0' : d > 0 ? `+${d}` : `${d}`
  }
  const teamMatchCfg = room.config.games.find(g => g.type === 'team-match')
  const matchStatusByHole: Record<number, number> = {}
  let matchOverallDiff = 0
  if (teamMatchCfg) {
    const t1 = teamMatchCfg.teams?.team1 ?? []
    const t2 = teamMatchCfg.teams?.team2 ?? []
    let diff = 0
    if (t1.length > 0 && t2.length > 0) {
      for (const h of [...teamMatchCfg.holes].sort((a, b) => a - b)) {
        const sc = room.holes[h]?.scores
        if (!sc || ![...t1, ...t2].every(id => sc[id] != null)) continue
        const s1 = t1.reduce((s, id) => s + sc[id], 0)
        const s2 = t2.reduce((s, id) => s + sc[id], 0)
        if (s1 < s2) diff += 1
        else if (s2 < s1) diff -= 1
        matchStatusByHole[h] = diff
      }
    }
    matchOverallDiff = diff
  }
  const matchCellText  = (d: number) => d === 0 ? 'T' : `${Math.abs(d)}UP`
  const matchCellColor = (d: number) => d > 0 ? '#2563eb' : d < 0 ? '#16a34a' : '#0f172a'

  const renderScorecard = (label: string, startHole: number) => {
    const holes  = Array.from({ length: 9 }, (_, i) => startHole + i)
    const parSum = holes.reduce((s, h) => s + (room.config.holePars[h - 1] ?? 4), 0)
    return (
      <div key={label} className="card" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '18%' }} />
            {holes.map(h => <col key={h} style={{ width: '7.6%' }} />)}
            <col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#14532d' }}>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontSize: 10, color: '#86efac', fontWeight: 700 }}>{label}</th>
              {holes.map(h => (
                <th key={h} style={{ padding: '7px 2px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#d1fae5' }}>{h}</th>
              ))}
              <th style={{ padding: '7px 4px', textAlign: 'center', fontSize: 10, color: '#86efac', fontWeight: 700 }}>T</th>
            </tr>
            <tr style={{ background: '#166534' }}>
              <td style={{ padding: '4px 6px', fontSize: 10, fontWeight: 700, color: '#bbf7d0' }}>PAR</td>
              {holes.map(h => (
                <td key={h} style={{ padding: '4px 2px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#d1fae5' }}>
                  {room.config.holePars[h - 1] ?? 4}
                </td>
              ))}
              <td style={{ padding: '4px 4px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#bbf7d0' }}>{parSum}</td>
            </tr>
            {teamMatchCfg && holes.every(h => teamMatchCfg.holes.includes(h)) && (
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '4px 6px', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>Match</td>
                {holes.map(h => {
                  const d = matchStatusByHole[h]
                  return (
                    <td key={h} style={{
                      padding: '4px 1px', textAlign: 'center', fontSize: 9, fontWeight: 800,
                      color: d !== undefined ? matchCellColor(d) : 'transparent',
                    }}>
                      {d !== undefined ? matchCellText(d) : ''}
                    </td>
                  )
                })}
                <td style={{ padding: '4px 2px', textAlign: 'center', fontSize: 9, fontWeight: 800, color: matchCellColor(matchOverallDiff) }}>
                  {Object.keys(matchStatusByHole).length > 0 ? matchCellText(matchOverallDiff) : ''}
                </td>
              </tr>
            )}
          </thead>
          <tbody>
            {players.map((p, pi) => {
              const rowScores = holes.map(h => room.holes[h]?.scores?.[p.id] ?? null)
              const entered   = rowScores.filter((s): s is number => s != null)
              const rowTotal  = entered.reduce((a, b) => a + b, 0)
              const isMe      = p.id === myId
              return (
                <tr key={p.id} style={{
                  background: isMe ? '#eff6ff' : pi % 2 === 0 ? '#fff' : '#f8fafc',
                  borderTop: '1px solid #f1f5f9',
                }}>
                  <td style={{ padding: '4px 4px 4px 6px', fontSize: 11, fontWeight: isMe ? 800 : 600, color: 'var(--text)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {playerTotals[p.id]?.isOecd && (
                        <span style={{ fontSize: 9, color: '#dc2626', flexShrink: 0 }}>●</span>
                      )}
                    </div>
                  </td>
                  {holes.map((h, idx) => {
                    const score = rowScores[idx]
                    const par   = room.config.holePars[h - 1] ?? 4
                    return (
                      <td key={h} style={{ padding: '7px 2px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: score == null ? '#e2e8f0' : scoreColor(score - par) }}>
                        {score == null ? '—'
                          : score - par <= -2 ? <span className="score-badge badge-violet">{relStr(score, par)}</span>
                          : score - par === -1 ? <span className="score-badge badge-green">{relStr(score, par)}</span>
                          : relStr(score, par)}
                      </td>
                    )
                  })}
                  <td style={{ padding: '7px 4px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: 'var(--text)', borderLeft: '1px solid #e2e8f0' }}>
                    {entered.length > 0 ? rowTotal : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="최종 정산">
            <defs>
              <linearGradient id="medal" x1="40" y1="9" x2="40" y2="65" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1f9d54" />
                <stop offset="1" stopColor="#13532e" />
              </linearGradient>
              <radialGradient id="sheen" cx="0.35" cy="0.28" r="0.85">
                <stop stopColor="#ffffff" stopOpacity="0.20" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* 월계수 (좌·우, 금색, 절제) */}
            <g stroke="#cda349" strokeWidth="2" strokeLinecap="round" fill="none">
              <path d="M22 64 C13 56 12 44 18 36" />
              <path d="M58 64 C67 56 68 44 62 36" />
            </g>
            <g fill="#cda349">
              <ellipse cx="15.5" cy="40" rx="4.2" ry="1.9" transform="rotate(-18 15.5 40)" />
              <ellipse cx="15" cy="47" rx="4.2" ry="1.9" transform="rotate(-2 15 47)" />
              <ellipse cx="17.5" cy="54" rx="4" ry="1.8" transform="rotate(20 17.5 54)" />
              <ellipse cx="64.5" cy="40" rx="4.2" ry="1.9" transform="rotate(18 64.5 40)" />
              <ellipse cx="65" cy="47" rx="4.2" ry="1.9" transform="rotate(2 65 47)" />
              <ellipse cx="62.5" cy="54" rx="4" ry="1.8" transform="rotate(-20 62.5 54)" />
            </g>
            {/* 메달 본체 */}
            <circle cx="40" cy="38" r="27" fill="url(#medal)" stroke="#cda349" strokeWidth="2.5" />
            <circle cx="40" cy="38" r="27" fill="url(#sheen)" />
            <circle cx="40" cy="38" r="22.5" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" />
            {/* 골프 깃발 엠블럼 */}
            <line x1="35" y1="26" x2="35" y2="48" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M35 25.5 L49 29.5 L35 33.5 Z" fill="#fde047" />
            <circle cx="43.5" cy="47.5" r="3" fill="#ffffff" />
            <path d="M27 49.5 Q40 46 53 49.5" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>최종 정산</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>방 코드: {roomId}</p>
      </div>

      {/* 최종 손익: 납부금 제외, 보유(지갑) + 신페리오 정산 합산 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 12, fontSize: 16 }}>최종 손익</p>
        {players
          .sort((a, b) =>
            ((playerTotals[b.id]?.wallet ?? 0) + (sinperioDeltas[b.id] ?? 0))
            - ((playerTotals[a.id]?.wallet ?? 0) + (sinperioDeltas[a.id] ?? 0)))
          .map((p, rank) => {
            const t = playerTotals[p.id]
            const net = (t?.wallet ?? 0) + (sinperioDeltas[p.id] ?? 0)
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
                </div>
              </div>
            )
          })}
      </div>


      {/* 신페리오 상세 — 플레이어간 별도 정산 */}
      {Object.keys(sinperioDeltas).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>신페리오 정산</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            선정 홀: {room.sinperioHoles.join(', ')}홀 · 핸디캡 적용 넷스코어 타수 차 정산
          </p>
          {players.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                그로스 {sinperioGross[p.id] ?? '-'} · 핸디 {sinperioHandicaps[p.id] ?? '-'} →{' '}
                <span style={{ fontWeight: 800, color: 'var(--green)' }}>넷 {sinperioNetScores[p.id] ?? '-'}타</span>
              </span>
            </div>
          ))}
          {sinperioTransfers.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              {sinperioTransfers.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 8, marginBottom: 6,
                  background: 'rgba(255,255,255,.03)',
                }}>
                  <span style={{ fontSize: 14 }}>
                    <span style={{ fontWeight: 700, color: '#f87171' }}>{s.from}</span>
                    <span style={{ color: 'var(--muted)' }}> → </span>
                    <span style={{ fontWeight: 700, color: '#4ade80' }}>{s.to}</span>
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--yellow)' }}>
                    {s.amount.toLocaleString()}원
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 스코어보드 */}
      {renderScorecard('전반', 1)}
      {renderScorecard('후반', 10)}
      <div style={{ marginBottom: 16 }} />

      {/* 홀별 게임 결과 요약 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 10 }}>게임별 홀 결과</p>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hr = holeResults[h]
          const buddies = buddyResults[h] ?? []
          const penalties = oecdResults[h] ?? []
          const events = eventResults[h] ?? []
          const relevantResults = (hr ?? []).filter(r => r.game !== 'sinperio')
          if (relevantResults.length === 0 && buddies.length === 0 && penalties.length === 0 && events.length === 0) return null
          return (
            <div key={h} style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{h}홀</p>
              {relevantResults.map((r, i) => (
                <div key={i} style={{ fontSize: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)', marginBottom: 5 }}>
                  <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{GAME_LABELS[r.game]}</span>
                  {resolveNames(r.detail, room.players).split(/\n| · /).map((line, k) => (
                    <div key={k} style={{ display: 'flex', gap: 5, alignItems: 'baseline', paddingLeft: 2 }}>
                      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>•</span>
                      <span>{line}</span>
                    </div>
                  ))}
                  {r.summary && (
                    <div style={{ textAlign: 'right', fontWeight: 800, color: r.carry ? '#dc2626' : '#16a34a', marginTop: 2 }}>
                      {resolveNames(r.summary, room.players)}
                    </div>
                  )}
                </div>
              ))}
              {buddies.map((b, i) => (
                <div key={`b${i}`} style={{ fontSize: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)', marginBottom: 3 }}>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>버디값</span>
                  <span style={{ color: 'var(--muted)' }}> · </span>
                  {room.players[b.id]?.name ?? b.id} {b.label}! ({b.count > 0 && b.amount === b.unit * b.count ? `+${b.unit.toLocaleString()}원 × ${b.count}인` : `+${b.amount.toLocaleString()}원`})
                </div>
              ))}
              {events.map((e, i) => (
                <div key={`e${i}`} style={{ fontSize: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)', marginBottom: 3 }}>
                  <span style={{ color: '#d97706', fontWeight: 600 }}>{e.label}</span>
                  <span style={{ color: 'var(--muted)' }}> · </span>
                  {e.id ? `${room.players[e.id]?.name ?? e.id} (+${e.amount.toLocaleString()}원)` : 'PASS'}
                </div>
              ))}
              {penalties.map((p, i) => (
                <div key={`p${i}`} style={{ fontSize: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)', marginBottom: 3 }}>
                  <span style={{ color: '#b91c1c', fontWeight: 600 }}>OECD 페널티</span>
                  <span style={{ color: 'var(--muted)' }}> · </span>
                  {room.players[p.id]?.name ?? p.id} (−{p.amount.toLocaleString()}원)
                  <span style={{ color: 'var(--muted)' }}> ({p.detail})</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <button className="btn btn-green" style={{ marginBottom: 8 }} onClick={() => router.push(`/play/${roomId}?view=1`)}>
        스코어보드 보기
      </button>
      <button className="btn btn-gray" style={{ marginBottom: 8 }} onClick={() => router.push('/')}>
        🏠 홈으로
      </button>
      <SupportButton variant="button" />
    </div>
  )
}
