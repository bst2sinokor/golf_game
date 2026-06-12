'use client'
import { useState } from 'react'
import { saveConfig, savePlayerAmounts, removePlayer, setPlayerOrder } from '@/lib/roomStore'
import type { Room, GameConfig, GameType, RoomConfig, OecdConfig, BuddyConfig } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'

const ALL_GAMES: GameType[] = ['stroke', 'team-match', 'jootanwootan', 'hussein', 'lasvegas', 'sinperio', 'scratch']

const GAME_DESC: Record<GameType, string> = {
  stroke:       '홀별 최저 타수 승자가 판돈 획득',
  'team-match': '사전 팀 구성, 홀별 팀 합산 타수 비교',
  jootanwootan: '티샷 방향(좌/우)으로 매 홀 팀 구성',
  hussein:      '직전 홀 2등 vs 1·3·4등 대결',
  lasvegas:     '직전 홀 1위+4위 vs 2위+3위 팀 대결 (4인 전용)',
  sinperio:     '18홀 완료 후 핸디캡 넷스코어 타수 차 정산',
  scratch:      '타수 차이만큼 금액을 서로 주고받음',
}

interface Props {
  room: Room
  roomId: string
  myId: string
}

type SettingsStep = 'players' | 'games' | 'pars' | 'money' | 'oecd'

export default function GameSettings({ room, roomId, myId }: Props) {
  // ── 플레이어 순서 (playerOrder 기반) ──
  const allIds = Object.keys(room.players)
  const orderedIds = (room.playerOrder && room.playerOrder.length === allIds.length)
    ? room.playerOrder.filter(id => room.players[id])
    : allIds
  const orderedPlayers = orderedIds.map(id => room.players[id]).filter(Boolean)

  // ── 설정 상태 (room.config 초기값) ──
  const [step, setStep] = useState<SettingsStep>('players')

  const initGames = room.config.games
  const [selGames, setSelGames] = useState<Set<GameType>>(
    () => new Set(initGames.map(g => g.type))
  )
  const [gameHoles, setGameHoles] = useState<Record<GameType, number[]>>(() => {
    const h: Partial<Record<GameType, number[]>> = {}
    initGames.forEach(g => { h[g.type] = g.holes })
    return h as Record<GameType, number[]>
  })
  const [gameBets, setGameBets] = useState<Record<GameType, number>>(() => {
    const b: Partial<Record<GameType, number>> = {}
    initGames.forEach(g => { b[g.type] = g.betPerHole ?? g.betPerStroke ?? g.totalBet ?? 10000 })
    return b as Record<GameType, number>
  })
  const [teams, setTeams] = useState<{ team1: string[]; team2: string[] }>(() => {
    const tm = initGames.find(g => g.type === 'team-match')
    return tm?.teams ?? { team1: [], team2: [] }
  })
  const [holePars, setHolePars] = useState<number[]>(() => [...room.config.holePars])
  const [initAmounts, setInitAmounts] = useState<Record<string, number>>(() => {
    const amounts: Record<string, number> = {}
    for (const p of Object.values(room.players)) amounts[p.id] = p.initialAmount ?? 0
    return amounts
  })
  const [oecd, setOecd] = useState<OecdConfig>(() => ({ ...room.config.oecd }))
  const [buddy, setBuddy] = useState<BuddyConfig>(() => ({
    ...( room.config.buddy ?? { enabled: false, baseDistribution: 0, buddyValue: 0 })
  }))
  const [betSteps, setBetSteps] = useState<Record<string, number>>({})
  const [oecdSteps, setOecdSteps] = useState<Record<string, number>>({ threshold: 10000, penaltyPerEvent: 10000, maxPerHole: 10000 })
  const [buddySteps, setBuddySteps] = useState<Record<string, number>>({ baseDistribution: 10000, buddyValue: 10000 })
  const [amountStep, setAmountStep] = useState(100000)
  const [amountConfirmed, setAmountConfirmed] = useState(() =>
    Object.values(room.players).every(p => (p.initialAmount ?? 0) > 0)
  )
  const [confirmedTotal, setConfirmedTotal] = useState(() =>
    Object.values(room.players).reduce((s, p) => s + (p.initialAmount ?? 0), 0)
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragInsertBeforeId, setDragInsertBeforeId] = useState<string | undefined>(undefined) // undefined = 맨 끝에 삽입

  // ── 헬퍼 ──
  function getHoleOwner(hole: number, excludeGame: GameType): GameType | null {
    for (const g of Array.from(selGames)) {
      if (g === excludeGame) continue
      if ((gameHoles[g] ?? []).includes(hole)) return g
    }
    return null
  }

  function toggleGame(g: GameType) {
    const next = new Set(selGames)
    if (next.has(g)) {
      next.delete(g)
    } else {
      next.add(g)
      if (!gameHoles[g]) setGameHoles(prev => ({ ...prev, [g]: [] }))
      if (!gameBets[g])  setGameBets(prev => ({ ...prev, [g]: 10000 }))
    }
    setSelGames(next)
  }

  function toggleHole(game: GameType, hole: number) {
    const cur = gameHoles[game] ?? []
    if (cur.includes(hole)) {
      setGameHoles(prev => ({ ...prev, [game]: cur.filter(h => h !== hole) }))
    } else {
      if (getHoleOwner(hole, game)) return
      setGameHoles(prev => ({ ...prev, [game]: [...cur, hole].sort((a, b) => a - b) }))
    }
  }

  function toggleRangeHoles(game: GameType, holes: number[]) {
    const cur = gameHoles[game] ?? []
    const allSelected = holes.every(h => cur.includes(h))
    if (allSelected) {
      setGameHoles(prev => ({ ...prev, [game]: cur.filter(h => !holes.includes(h)) }))
    } else {
      const toAdd = holes.filter(h => !cur.includes(h) && !getHoleOwner(h, game))
      setGameHoles(prev => ({ ...prev, [game]: [...cur, ...toAdd].sort((a, b) => a - b) }))
    }
  }

  function assignTeam(playerId: string, team: 'team1' | 'team2') {
    setTeams(prev => {
      const t1 = prev.team1.filter(id => id !== playerId)
      const t2 = prev.team2.filter(id => id !== playerId)
      if (team === 'team1') return { team1: [...t1, playerId], team2: t2 }
      return { team1: t1, team2: [...t2, playerId] }
    })
  }

  async function handleSave() {
    setSaving(true)
    const games: GameConfig[] = Array.from(selGames).map(type => {
      const cfg: GameConfig = {
        type,
        holes: gameHoles[type] ?? Array.from({ length: 18 }, (_, i) => i + 1),
      }
      if (type === 'scratch')       cfg.betPerStroke = gameBets[type] ?? 1000
      else if (type === 'sinperio') cfg.totalBet      = gameBets[type] ?? 1000
      else                          cfg.betPerHole    = gameBets[type] ?? 5000
      if (type === 'team-match')    cfg.teams         = teams
      return cfg
    })
    const config: RoomConfig = { holePars, games, oecd, buddy }
    await Promise.all([
      saveConfig(roomId, config),
      savePlayerAmounts(roomId, initAmounts),
    ])
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleRemove(playerId: string) {
    const newOrder = orderedIds.filter(id => id !== playerId)
    await removePlayer(roomId, playerId, newOrder)
  }

  function handleOrderDrop() {
    if (!draggingId) return
    const ids = orderedPlayers.map(p => p.id)
    const fromIdx = ids.indexOf(draggingId)
    const next = [...ids]
    next.splice(fromIdx, 1)
    const insertIdx = dragInsertBeforeId == null
      ? next.length
      : next.indexOf(dragInsertBeforeId)
    next.splice(insertIdx < 0 ? next.length : insertIdx, 0, draggingId)
    setPlayerOrder(roomId, next)
    setDraggingId(null)
    setDragInsertBeforeId(undefined)
  }

  // ── 렌더 ──
  const STEP_LABELS: Record<SettingsStep, string> = {
    players: '플레이어', games: '게임선택', pars: '홀파설정', money: '판돈설정', oecd: '기타',
  }

  return (
    <div>
      {/* 스텝 탭 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(Object.keys(STEP_LABELS) as SettingsStep[]).map(s => (
          <button key={s} onClick={() => setStep(s)} style={{
            flex: 1, padding: '7px 2px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 600,
            background: step === s ? 'var(--blue)' : 'var(--card)',
            color: step === s ? '#fff' : 'var(--muted)',
            border: '1px solid var(--border)',
          }}>
            {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {/* ① 플레이어 관리 */}
      {step === 'players' && (
        <div className="card">
          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>플레이어 관리</p>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>⠿ 핸들을 드래그하여 순서 변경</p>
          {orderedPlayers.map(p => (
            <div key={p.id}>
              {/* 삽입 위치 바 */}
              {draggingId && draggingId !== p.id && dragInsertBeforeId === p.id && (
                <div style={{ height: 3, background: '#3b82f6', borderRadius: 2, margin: '2px 4px' }} />
              )}
              <div
                draggable
                onDragStart={() => setDraggingId(p.id)}
                onDragEnd={() => { setDraggingId(null); setDragInsertBeforeId(undefined) }}
                onDragOver={e => {
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const mid = rect.top + rect.height / 2
                  if (e.clientY < mid) {
                    setDragInsertBeforeId(p.id)
                  } else {
                    const idx = orderedPlayers.findIndex(x => x.id === p.id)
                    const next = orderedPlayers[idx + 1]
                    setDragInsertBeforeId(next ? next.id : undefined)
                  }
                }}
                onDrop={handleOrderDrop}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 8px', borderRadius: 8, marginBottom: 4,
                  border: '1px solid var(--border)',
                  background: draggingId === p.id ? '#f1f5f9' : 'var(--card)',
                  opacity: draggingId === p.id ? 0.4 : 1,
                  cursor: 'grab',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18, color: '#cbd5e1', lineHeight: 1, userSelect: 'none' }}>⠿</span>
                  <span style={{ fontSize: 14, fontWeight: p.id === myId ? 800 : 600 }}>{p.name}</span>
                  {p.id === myId && (
                    <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700 }}>나 (진행자)</span>
                  )}
                </div>
                {p.id !== myId && (
                  <button onClick={e => { e.stopPropagation(); handleRemove(p.id) }} style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5',
                    background: '#fef2f2', color: '#dc2626', fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}>
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
          {/* 맨 끝 삽입 바 */}
          {draggingId && dragInsertBeforeId === undefined && (
            <div style={{ height: 3, background: '#3b82f6', borderRadius: 2, margin: '2px 4px' }} />
          )}
        </div>
      )}

      {/* ② 게임 선택 */}
      {step === 'games' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ALL_GAMES.map(g => (
            <div key={g}>
              <div className="card" onClick={() => toggleGame(g)} style={{
                cursor: 'pointer',
                border: selGames.has(g) ? '2px solid var(--green)' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: 700, marginBottom: 2 }}>{GAME_LABELS[g]}</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>{GAME_DESC[g]}</p>
                  </div>
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, border: `2px solid ${selGames.has(g) ? 'var(--green)' : '#cbd5e1'}`,
                    background: selGames.has(g) ? 'var(--green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 8,
                  }}>
                    {selGames.has(g) && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                  </div>
                </div>
              </div>

              {/* 팀 매치: 팀 구성 */}
              {selGames.has(g) && g === 'team-match' && (
                <div className="card" style={{ marginTop: 8, background: 'var(--bg)' }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>팀 구성</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['team1', 'team2'] as const).map((t, i) => (
                      <div key={t} style={{ flex: 1, padding: 10, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}>
                        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: i === 0 ? '#2563eb' : '#dc2626' }}>
                          {i === 0 ? '🔵 팀 A' : '🔴 팀 B'}
                        </p>
                        {orderedPlayers.map(p => (
                          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                            <input type="checkbox" checked={teams[t].includes(p.id)} onChange={() => assignTeam(p.id, t)} />
                            <span style={{ fontSize: 14 }}>{p.name}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 적용 홀 선택 */}
              {selGames.has(g) && (
                <div className="card" style={{ marginTop: 8, background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <p style={{ fontSize: 13, color: 'var(--muted)' }}>적용 홀</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[
                        { label: '전체', holes: Array.from({ length: 18 }, (_, i) => i + 1) },
                        { label: '전반', holes: Array.from({ length: 9 },  (_, i) => i + 1) },
                        { label: '후반', holes: Array.from({ length: 9 },  (_, i) => i + 10) },
                      ].map(({ label, holes }) => {
                        const cur = gameHoles[g] ?? []
                        const allSel = holes.every(h => cur.includes(h))
                        return (
                          <button key={label} onClick={() => toggleRangeHoles(g, holes)} style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                            border: '1px solid var(--border)',
                            background: allSel ? 'var(--blue)' : 'transparent',
                            color: allSel ? '#fff' : 'var(--muted)',
                            fontWeight: allSel ? 700 : 400,
                          }}>{label}</button>
                        )
                      })}
                      <button onClick={() => setGameHoles(prev => ({ ...prev, [g]: [] }))} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                        border: '1px solid #fca5a5', background: 'transparent',
                        color: '#ef4444',
                      }}>전체 해제</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
                      const sel   = (gameHoles[g] ?? []).includes(h)
                      const owner = !sel ? getHoleOwner(h, g) : null
                      return (
                        <button key={h} onClick={() => toggleHole(g, h)} style={{
                          width: 36, height: 36, borderRadius: 8, border: 'none',
                          cursor: owner ? 'not-allowed' : 'pointer',
                          fontWeight: 700, fontSize: 13,
                          background: sel ? 'var(--green)' : owner ? '#f1f5f9' : 'var(--border)',
                          color: sel ? '#fff' : owner ? '#cbd5e1' : 'var(--muted)',
                          opacity: owner ? 0.5 : 1,
                        }} title={owner ? `${GAME_LABELS[owner]}에 배정됨` : undefined}>
                          {h}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ③ 홀 파 설정 */}
      {step === 'pars' && (
        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 4 }}>홀별 파 설정</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>총 파: {holePars.reduce((s, p) => s + p, 0)}</p>
          {['전반 (1~9홀)', '후반 (10~18홀)'].map((label, half) => (
            <div key={half} style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{label}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Array.from({ length: 9 }, (_, i) => i + half * 9).map(idx => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{idx + 1}홀</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {[3, 4, 5].map(p => (
                        <button key={p} onClick={() => setHolePars(prev => { const n = [...prev]; n[idx] = p; return n })} style={{
                          width: 32, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                          fontSize: 13, fontWeight: 600,
                          background: holePars[idx] === p
                            ? (p === 3 ? 'var(--blue)' : p === 4 ? 'var(--green)' : 'var(--yellow)')
                            : 'var(--border)',
                          color: holePars[idx] === p ? '#fff' : 'var(--muted)',
                        }}>{p}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ④ 판돈 설정 */}
      {step === 'money' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from(selGames).map(g => {
            const val     = gameBets[g] ?? 10000
            const bStep   = betSteps[g] ?? 10000
            const setVal  = (n: number) => setGameBets(prev => ({ ...prev, [g]: Math.max(0, n) }))
            const setBStep = (v: number) => setBetSteps(prev => ({ ...prev, [g]: v }))
            return (
              <div key={g} className="card">
                <p style={{ fontWeight: 700, marginBottom: 8 }}>{GAME_LABELS[g]}</p>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>
                  {g === 'scratch' || g === 'sinperio' ? '타당 금액 (원)' : '홀당 금액 (원)'}
                </label>
                {/* 단위 선택 */}
                <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                  {[{ v: 1000, l: '1천' }, { v: 5000, l: '5천' }, { v: 10000, l: '1만' }].map(({ v, l }) => (
                    <button key={v} onClick={() => setBStep(v)} style={{
                      flex: 1, padding: '6px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      border: '1px solid var(--border)',
                      background: bStep === v ? 'var(--blue)' : 'var(--bg)',
                      color: bStep === v ? '#fff' : 'var(--muted)',
                    }}>{l}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="text" inputMode="numeric"
                    value={val === 0 ? '' : val.toLocaleString()}
                    onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setVal(raw === '' ? 0 : Number(raw)) }}
                    onFocus={e => e.target.select()}
                    style={{ flex: 1, minWidth: 0 }} />
                  <button onClick={() => setVal(val - bStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                  <button onClick={() => setVal(val + bStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                </div>
              </div>
            )
          })}

          {/* 납부금액 */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontWeight: 700 }}>참가자 납부액</p>
              {amountConfirmed && (
                <span style={{ fontSize: 13, color: 'var(--blue)', fontWeight: 700 }}>
                  총 {confirmedTotal.toLocaleString()}원
                </span>
              )}
            </div>
            {/* 단위 선택 */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
              {[{ v: 10000, l: '1만' }, { v: 30000, l: '3만' }, { v: 50000, l: '5만' }, { v: 100000, l: '10만' }].map(({ v, l }) => (
                <button key={v} onClick={() => setAmountStep(v)} style={{
                  flex: 1, padding: '6px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  border: '1px solid var(--border)',
                  background: amountStep === v ? 'var(--blue)' : 'var(--bg)',
                  color: amountStep === v ? '#fff' : 'var(--muted)',
                }}>{l}</button>
              ))}
            </div>
            {orderedPlayers.map(p => {
              const val    = initAmounts[p.id] ?? 0
              const setVal = (n: number) => {
                setInitAmounts(prev => ({ ...prev, [p.id]: Math.max(0, n) }))
                setAmountConfirmed(false)
              }
              return (
                <div key={p.id} style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 4 }}>{p.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="text" inputMode="numeric"
                      value={val === 0 ? '' : val.toLocaleString()}
                      onChange={e => {
                        const raw = e.target.value.replace(/,/g, '').replace(/\D/g, '')
                        setVal(raw === '' ? 0 : Number(raw))
                      }}
                      onFocus={e => e.target.select()}
                      style={{ flex: 1, minWidth: 0 }} />
                    <button onClick={() => setVal(val - amountStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                    <button onClick={() => setVal(val + amountStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                  </div>
                </div>
              )
            })}
            {/* 납부 완료 버튼 */}
            {orderedPlayers.every(p => (initAmounts[p.id] ?? 0) > 0) && !amountConfirmed && (
              <button
                className="btn btn-green"
                style={{ marginTop: 4 }}
                onClick={async () => {
                  await savePlayerAmounts(roomId, initAmounts)
                  const total = orderedPlayers.reduce((s, p) => s + (initAmounts[p.id] ?? 0), 0)
                  setConfirmedTotal(total)
                  setAmountConfirmed(true)
                }}
              >
                납부 완료
              </button>
            )}
            {amountConfirmed && (
              <p style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, textAlign: 'center', marginTop: 6 }}>
                납부 금액이 저장되었습니다.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ⑤ 기타 (OECD + 버디설정) */}
      {step === 'oecd' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* OECD */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 700 }}>OECD 규칙</p>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>일정 금액 이상 획득 시 페널티 적용</p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={oecd.enabled}
                  onChange={e => setOecd(prev => ({ ...prev, enabled: e.target.checked }))} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>활성화</span>
              </label>
            </div>
            {oecd.enabled && (
              <>
                <div className="divider" />
                {[
                  { key: 'threshold',       label: 'OECD 가입 기준 (원)'   },
                  { key: 'penaltyPerEvent', label: '이벤트당 페널티 (원)'   },
                  { key: 'maxPerHole',      label: '홀당 페널티 상한 (원)' },
                ].map(({ key, label }) => {
                  const val    = oecd[key as keyof OecdConfig] as number
                  const oStep  = oecdSteps[key] ?? 1000
                  const setVal = (n: number) => setOecd(prev => ({ ...prev, [key]: Math.max(0, n) }))
                  return (
                    <div key={key}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>{label}</label>
                      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                        {[{ v: 1000, l: '1천' }, { v: 5000, l: '5천' }, { v: 10000, l: '1만' }].map(({ v, l }) => (
                          <button key={v} onClick={() => setOecdSteps(prev => ({ ...prev, [key]: v }))} style={{
                            flex: 1, padding: '6px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                            border: '1px solid var(--border)',
                            background: oStep === v ? 'var(--blue)' : 'var(--bg)',
                            color: oStep === v ? '#fff' : 'var(--muted)',
                          }}>{l}</button>
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="text" inputMode="numeric"
                          value={val === 0 ? '' : val.toLocaleString()}
                          onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setVal(raw === '' ? 0 : Number(raw)) }}
                          onFocus={e => e.target.select()}
                          style={{ flex: 1, minWidth: 0 }} />
                        <button onClick={() => setVal(val - oStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                        <button onClick={() => setVal(val + oStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                      </div>
                    </div>
                  )
                })}
                <div style={{ padding: 10, background: 'var(--bg)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                  OB · Hazard · Bunker · Three Putt · Triple Bogey+ (Par 3: Double Bogey+)<br />
                  각 {oecd.penaltyPerEvent.toLocaleString()}원, 홀당 최대 {oecd.maxPerHole.toLocaleString()}원
                </div>
              </>
            )}
          </div>

          {/* 버디 설정 */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 700 }}>버디값 설정</p>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>기본금액 분배 및 버디 보너스</p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={buddy.enabled}
                  onChange={e => setBuddy(prev => ({ ...prev, enabled: e.target.checked }))} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>활성화</span>
              </label>
            </div>
            {buddy.enabled && (
              <>
                <div className="divider" />
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>같은 팀에게도 버디값 받기</label>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[{ v: false, l: '안받기' }, { v: true, l: '받기' }].map(({ v, l }) => (
                      <button key={l} onClick={() => setBuddy(prev => ({ ...prev, collectFromTeammates: v }))} style={{
                        flex: 1, padding: '8px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                        border: '1px solid var(--border)',
                        background: (buddy.collectFromTeammates ?? false) === v ? 'var(--blue)' : 'var(--bg)',
                        color: (buddy.collectFromTeammates ?? false) === v ? '#fff' : 'var(--muted)',
                      }}>{l}</button>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    안받기 시 해당 홀 팀 게임(팀매치·좌탄우탄·라스베가스)의 같은 팀원에게는 받지 않음
                  </p>
                </div>
                {([
                  { key: 'baseDistribution', label: '기본금액 분배 (원/인)', desc: '첫 홀 시작 시 각 플레이어에게 지급' },
                  { key: 'buddyValue',        label: '버디값 (원/인)',         desc: '버디 달성 시 나머지 플레이어 각 인당 지급' },
                ] as { key: keyof BuddyConfig; label: string; desc: string }[]).map(({ key, label, desc }) => {
                  const val    = buddy[key] as number
                  const bStep  = buddySteps[key as string] ?? 10000
                  const setVal = (n: number) => setBuddy(prev => ({ ...prev, [key]: Math.max(0, n) }))
                  return (
                    <div key={key as string}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 2 }}>{label}</label>
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{desc}</p>
                      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                        {[{ v: 1000, l: '1천' }, { v: 5000, l: '5천' }, { v: 10000, l: '1만' }].map(({ v, l }) => (
                          <button key={v} onClick={() => setBuddySteps(prev => ({ ...prev, [key as string]: v }))} style={{
                            flex: 1, padding: '6px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                            border: '1px solid var(--border)',
                            background: bStep === v ? 'var(--blue)' : 'var(--bg)',
                            color: bStep === v ? '#fff' : 'var(--muted)',
                          }}>{l}</button>
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="text" inputMode="numeric"
                          value={val === 0 ? '' : val.toLocaleString()}
                          onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setVal(raw === '' ? 0 : Number(raw)) }}
                          onFocus={e => e.target.select()}
                          style={{ flex: 1, minWidth: 0 }} />
                        <button onClick={() => setVal(val - bStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                        <button onClick={() => setVal(val + bStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* 저장 버튼 (플레이어 탭 제외) */}
      {step !== 'players' && (
        <div style={{ marginTop: 16 }}>
          <button className={`btn ${saved ? 'btn-green' : 'btn-blue'}`}
            onClick={handleSave} disabled={saving || saved}>
            {saved ? '저장 완료' : saving ? '저장 중...' : '변경 적용'}
          </button>
        </div>
      )}
    </div>
  )
}
