'use client'
import { useEffect, useState, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom, saveHoleData, setCurrentHole, finishGame } from '@/lib/roomStore'
import type { Room, OecdEvents } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'
import { calcAllResults } from '@/lib/gameLogic'

const EMPTY_OECD: OecdEvents = { ob: 0, hazard: 0, bunker: 0, threePutt: false, tripleOrWorse: false }

export default function PlayPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom] = useState<Room | null>(null)
  const [myId, setMyId] = useState('')
  const [viewHole, setViewHole] = useState(1)
  const [scoreInput, setScoreInput] = useState<number | ''>('')
  const [oecdInput, setOecdInput]   = useState<OecdEvents>(EMPTY_OECD)
  const [dirInput, setDirInput]     = useState<'left' | 'right' | ''>('')
  const [saving, setSaving]         = useState(false)
  const [showScoreboard, setShowScoreboard] = useState(false)

  useEffect(() => {
    const pid = localStorage.getItem('golf_player') ?? ''
    setMyId(pid)
    const unsub = subscribeRoom(roomId, r => {
      setRoom(r)
      setViewHole(r.currentHole)
    })
    return unsub
  }, [roomId])

  // 현재 홀 내 입력 초기화
  useEffect(() => {
    if (!room || !myId) return
    const saved = room.holes[viewHole]
    setScoreInput(saved?.scores?.[myId] ?? '')
    setOecdInput(saved?.oecd?.[myId] ?? { ...EMPTY_OECD })
    setDirInput(saved?.jootanwootan?.[myId] ?? '')
  }, [viewHole, room, myId])

  const isHost = room?.hostPlayerId === myId

  const hasJootanwootan = (hole: number) =>
    room?.config.games.some(g => g.type === 'jootanwootan' && g.holes.includes(hole)) ?? false

  const isOecdPlayer = useCallback(() => {
    if (!room || !room.config.oecd.enabled) return false
    const results = calcAllResults(room)
    const total = results.playerTotals[myId]
    if (!total) return false
    const running = (room.players[myId]?.initialAmount ?? 0) + total.gameAmount
    return running >= room.config.oecd.threshold
  }, [room, myId])

  async function saveScore() {
    if (!room || scoreInput === '') return
    setSaving(true)
    await saveHoleData(roomId, viewHole, {
      scores: { [myId]: Number(scoreInput) },
      oecd:   { [myId]: oecdInput },
      jootanwootan: dirInput ? { [myId]: dirInput } : undefined,
    })
    setSaving(false)
  }

  async function handleNextHole() {
    if (!isHost || !room) return
    if (viewHole === 18) {
      await finishGame(roomId)
      router.push(`/result/${roomId}`)
      return
    }
    await setCurrentHole(roomId, viewHole + 1)
  }

  if (!room) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>로딩 중...</div>
  if (room.status === 'finished') { router.push(`/result/${roomId}`); return null }

  const players    = Object.values(room.players)
  const holePar    = room.config.holePars[viewHole - 1] ?? 4
  const holeScores = room.holes[viewHole]?.scores ?? {}
  const results    = calcAllResults(room)
  const myScore    = holeScores[myId]
  const allEntered = players.every(p => holeScores[p.id] != null)

  const holeGames = room.config.games.filter(g => g.holes.includes(viewHole))
  const holeResults = results.holeResults[viewHole] ?? []

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '12px 16px 100px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{viewHole}홀</h1>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>파 {holePar}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowScoreboard(!showScoreboard)} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: showScoreboard ? 'var(--blue)' : 'transparent',
            color: showScoreboard ? '#fff' : 'var(--muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>📊 점수판</button>
          <span style={{ fontSize: 13, color: 'var(--muted)', padding: '6px 0' }}>{roomId}</span>
        </div>
      </div>

      {/* 홀 선택 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, overflowX: 'auto', paddingBottom: 4 }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const entered = players.every(p => room.holes[h]?.scores?.[p.id] != null)
          const isCurrent = h === room.currentHole
          return (
            <button key={h} onClick={() => setViewHole(h)} style={{
              minWidth: 32, height: 32, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
              background: h === viewHole ? 'var(--blue)' : entered ? 'rgba(34,197,94,.2)' : 'var(--card)',
              color: h === viewHole ? '#fff' : entered ? '#4ade80' : isCurrent ? 'var(--yellow)' : 'var(--muted)',
              outline: isCurrent && h !== viewHole ? '1px solid var(--yellow)' : 'none',
            }}>{h}</button>
          )
        })}
      </div>

      {/* 점수판 */}
      {showScoreboard && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ fontWeight: 700, marginBottom: 10, fontSize: 15 }}>누적 손익</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {players.sort((a, b) => (results.playerTotals[b.id]?.net ?? 0) - (results.playerTotals[a.id]?.net ?? 0))
              .map(p => {
                const t = results.playerTotals[p.id]
                const net = t?.net ?? 0
                const bal = p.initialAmount + net
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                      {t?.isOecd && <span className="tag-red">OECD</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 800, fontSize: 16, color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {net >= 0 ? '+' : ''}{net.toLocaleString()}원
                      </span>
                      {p.initialAmount > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block' }}>
                          잔액 {bal.toLocaleString()}원
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>

          {/* 홀 결과 */}
          {holeResults.length > 0 && allEntered && (
            <>
              <div className="divider" />
              <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>{viewHole}홀 결과</p>
              {holeResults.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{GAME_LABELS[r.game]}</span> · {r.detail}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* 현재 홀 스코어 현황 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
          {viewHole}홀 스코어 현황 ({Object.keys(holeScores).length}/{players.length}명 입력)
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {players.map(p => {
            const s = holeScores[p.id]
            const diff = s != null ? s - holePar : null
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}{p.id === myId ? ' (나)' : ''}</span>
                {s != null ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 18 }}>{s}</span>
                    <span style={{
                      fontSize: 12, padding: '2px 6px', borderRadius: 4,
                      background: diff === 0 ? 'rgba(148,163,184,.15)' : diff! < 0 ? 'rgba(34,197,94,.2)' : diff! === 1 ? 'rgba(234,179,8,.2)' : 'rgba(239,68,68,.2)',
                      color: diff === 0 ? 'var(--muted)' : diff! < 0 ? '#4ade80' : diff! === 1 ? '#fbbf24' : '#f87171',
                    }}>
                      {diff === 0 ? 'PAR' : diff! < 0 ? diff : `+${diff}`}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>미입력</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 내 스코어 입력 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontWeight: 700, marginBottom: 12 }}>내 스코어 입력 ({room.players[myId]?.name})</p>

        {/* 타수 입력 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>타수</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setScoreInput(prev => Math.max(1, Number(prev || holePar) - 1))}
              style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 22, cursor: 'pointer', fontWeight: 700 }}>−</button>
            <input type="number" value={scoreInput} min={1} max={20}
              onChange={e => setScoreInput(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ textAlign: 'center', fontSize: 28, fontWeight: 800, padding: '8px', flex: 1 }} />
            <button onClick={() => setScoreInput(prev => Number(prev || holePar) + 1)}
              style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 22, cursor: 'pointer', fontWeight: 700 }}>+</button>
          </div>
          {/* 빠른 선택 */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[holePar - 2, holePar - 1, holePar, holePar + 1, holePar + 2, holePar + 3].filter(s => s > 0).map(s => {
              const label = s < holePar - 1 ? 'EAGLE' : s === holePar - 1 ? 'BIRDIE' : s === holePar ? 'PAR' : s === holePar + 1 ? 'BOGEY' : s === holePar + 2 ? 'DBL' : 'TRP+'
              return (
                <button key={s} onClick={() => setScoreInput(s)} style={{
                  flex: 1, padding: '6px 2px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700,
                  background: Number(scoreInput) === s ? (s < holePar ? 'var(--green)' : s === holePar ? 'var(--border)' : s === holePar + 1 ? 'rgba(234,179,8,.3)' : 'rgba(239,68,68,.3)') : 'var(--border)',
                  color: Number(scoreInput) === s ? '#fff' : 'var(--muted)',
                }}>{s}<br />{label}</button>
              )
            })}
          </div>
        </div>

        {/* 좌탄우탄 방향 */}
        {hasJootanwootan(viewHole) && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>좌탄우탄 티샷 방향</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['left', 'right'] as const).map(d => (
                <button key={d} onClick={() => setDirInput(d)} style={{
                  flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
                  fontWeight: 700, fontSize: 15,
                  background: dirInput === d ? (d === 'left' ? 'var(--blue)' : 'var(--red)') : 'var(--card)',
                  color: dirInput === d ? '#fff' : 'var(--muted)',
                }}>
                  {d === 'left' ? '⬅️ 좌탄' : '➡️ 우탄'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* OECD 페널티 */}
        {room.config.oecd.enabled && isOecdPlayer() && (
          <div style={{ marginBottom: 14, padding: 12, background: 'rgba(239,68,68,.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,.2)' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>🏛️ OECD 페널티 (가입됨)</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { key: 'ob',            label: 'OB',     isCount: true },
                { key: 'hazard',        label: '해저드', isCount: true },
                { key: 'bunker',        label: '벙커',   isCount: true },
                { key: 'threePutt',     label: '3퍼팅',  isCount: false },
                { key: 'tripleOrWorse', label: holePar === 3 ? '더블+' : '트리플+', isCount: false },
              ].map(({ key, label, isCount }) => {
                const val = oecdInput[key as keyof OecdEvents]
                return (
                  <div key={key} onClick={() => {
                    if (isCount) {
                      setOecdInput(prev => ({ ...prev, [key]: (prev[key as keyof OecdEvents] as number) + 1 }))
                    } else {
                      setOecdInput(prev => ({ ...prev, [key]: !prev[key as keyof OecdEvents] }))
                    }
                  }} style={{
                    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                    background: (isCount ? (val as number) > 0 : val) ? 'rgba(239,68,68,.3)' : 'var(--card)',
                    border: '1px solid var(--border)', fontSize: 13, fontWeight: 600,
                    color: (isCount ? (val as number) > 0 : val) ? '#f87171' : 'var(--muted)',
                  }}>
                    {label}{isCount && (val as number) > 0 ? ` ×${val}` : ''}
                    {isCount && (val as number) > 0 && (
                      <span onClick={e => { e.stopPropagation(); setOecdInput(prev => ({ ...prev, [key]: Math.max(0, (prev[key as keyof OecdEvents] as number) - 1) })) }}
                        style={{ marginLeft: 6, opacity: .7 }}>↩</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <button className="btn btn-blue" onClick={saveScore} disabled={scoreInput === '' || saving}>
          {saving ? '저장 중...' : myScore != null ? '✏️ 수정' : '✅ 입력'}
        </button>
      </div>

      {/* 이번 홀 게임 */}
      {holeGames.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>이번 홀 게임</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {holeGames.map(g => (
              <span key={g.type} className="tag-blue">{GAME_LABELS[g.type]}</span>
            ))}
          </div>
        </div>
      )}

      {/* 진행자: 다음 홀 이동 */}
      {isHost && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <button className={`btn ${viewHole === 18 ? 'btn-red' : 'btn-green'}`}
              onClick={handleNextHole}
              disabled={!allEntered}>
              {viewHole === 18 ? '🏆 최종 정산' : `➡️ ${viewHole + 1}홀로 이동`}
              {!allEntered && ` (${players.length - Object.keys(holeScores).length}명 미입력)`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
