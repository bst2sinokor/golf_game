'use client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom, saveConfig, startGame, savePlayerAmounts } from '@/lib/roomStore'
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

const DEFAULT_PAR = [4,3,4,4,5,3,4,5,4, 4,3,4,4,5,3,4,5,4]

export default function SetupPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom]     = useState<Room | null>(null)
  const [myId, setMyId]     = useState('')
  const [step, setStep]     = useState<'games' | 'pars' | 'money' | 'extras'>('games')

  // 선택 게임
  const [selGames, setSelGames] = useState<Set<GameType>>(new Set())
  // 게임별 적용 홀 (기본 전체)
  const [gameHoles, setGameHoles] = useState<Record<GameType, number[]>>({} as Record<GameType, number[]>)
  // 게임별 판돈
  const [gameBets, setGameBets] = useState<Record<GameType, number>>({} as Record<GameType, number>)
  // 팀 구성 (team-match)
  const [teams, setTeams] = useState<{ team1: string[]; team2: string[] }>({ team1: [], team2: [] })
  // 홀별 파
  const [holePars, setHolePars] = useState<number[]>(DEFAULT_PAR)
  // 기본금액
  const [initAmounts, setInitAmounts] = useState<Record<string, number>>({})
  // OECD
  const [oecd, setOecd] = useState<OecdConfig>({
    enabled: false, threshold: 60000, penaltyPerEvent: 10000, maxPerHole: 20000,
  })
  // 버디
  const [buddy, setBuddy] = useState<BuddyConfig>({
    enabled: false, baseDistribution: 0, buddyValue: 0, collectFromTeammates: false,
  })
  // 판돈 단위
  const [betSteps, setBetSteps] = useState<Record<string, number>>({})
  const [oecdSteps, setOecdSteps] = useState<Record<string, number>>({ threshold: 10000, penaltyPerEvent: 10000, maxPerHole: 10000 })
  const [buddySteps, setBuddySteps] = useState<Record<string, number>>({ baseDistribution: 10000, buddyValue: 10000 })
  // 납부액 단위 및 완료 상태
  const [amountStep, setAmountStep] = useState(100000)
  const [amountConfirmed, setAmountConfirmed] = useState(false)
  const [confirmedTotal, setConfirmedTotal] = useState(0)

  useEffect(() => {
    const pid = sessionStorage.getItem('golf_player')
             ?? localStorage.getItem(`golf_player_${roomId}`)
             ?? ''
    setMyId(pid)
    const unsub = subscribeRoom(roomId, r => {
      setRoom(r)
      const amounts: Record<string, number> = {}
      for (const p of Object.values(r.players)) amounts[p.id] = p.initialAmount ?? 0
      setInitAmounts(amounts)
    })
    return unsub
  }, [roomId])

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

  // 해당 홀이 다른 게임에 이미 배정됐는지 확인
  function getHoleOwner(hole: number, excludeGame: GameType): GameType | null {
    for (const g of Array.from(selGames)) {
      if (g === excludeGame) continue
      if ((gameHoles[g] ?? []).includes(hole)) return g
    }
    return null
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

  async function handleStart() {
    if (!room) return
    const games: GameConfig[] = Array.from(selGames).map(type => {
      const cfg: GameConfig = {
        type,
        holes: gameHoles[type] ?? Array.from({ length: 18 }, (_, i) => i + 1),
      }
      if (type === 'scratch')   cfg.betPerStroke = gameBets[type] ?? 1000
      else if (type === 'sinperio') cfg.totalBet  = gameBets[type] ?? 1000
      else                      cfg.betPerHole   = gameBets[type] ?? 5000
      if (type === 'team-match') cfg.teams = { team1: teams.team1, team2: teams.team2 }
      return cfg
    })

    const config: RoomConfig = { holePars, games, oecd, buddy }

    // 기본금액 업데이트
    for (const [pid, amount] of Object.entries(initAmounts)) {
      room.players[pid].initialAmount = amount
    }

    await saveConfig(roomId, config)
    await startGame(roomId)
    router.push(`/play/${roomId}`)
  }

  if (!room) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>로딩 중...</div>

  const isHost = room.hostPlayerId === myId
  const players = Object.values(room.players)

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 80px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <circle cx="24" cy="24" r="23" stroke="var(--green)" strokeWidth="2"/>
          <line x1="24" y1="10" x2="24" y2="40" stroke="var(--green)" strokeWidth="2" strokeLinecap="round"/>
          <polygon points="24,10 36,16 24,22" fill="var(--green)"/>
          <ellipse cx="24" cy="40" rx="6" ry="2" fill="var(--green)" opacity=".3"/>
        </svg>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>게임 설정</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>방 코드</span>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 3, color: 'var(--green)' }}>{roomId}</span>
          </div>
        </div>
      </div>

      {/* 참가자 현황 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>참가자 {players.length}명</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {players.map(p => (
            <span key={p.id} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 14, fontWeight: 600,
              background: p.isHost ? 'rgba(34,197,94,.2)' : 'rgba(59,130,246,.15)',
              color: p.isHost ? '#4ade80' : '#93c5fd',
              border: p.id === myId ? '1px solid currentColor' : '1px solid transparent',
            }}>
              {p.name}{p.isHost ? ' 👑' : ''}
            </span>
          ))}
        </div>
      </div>

      {!isHost ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <p style={{ fontSize: 24, marginBottom: 8 }}>⏳</p>
          <p>진행자가 설정 중입니다...</p>
        </div>
      ) : (
        <>
          {/* 스텝 탭 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {(['games', 'pars', 'money', 'extras'] as const).map((s, i) => (
              <button key={s} onClick={() => setStep(s)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: step === s ? 'var(--blue)' : 'var(--card)',
                color: step === s ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>
                {['게임선택', '홀파설정', '판돈설정', '기타'][i]}
              </button>
            ))}
          </div>

          {/* ① 게임 선택 */}
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
                      <span style={{ fontSize: 20, marginLeft: 8 }}>{selGames.has(g) ? '✅' : '⬜'}</span>
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
                            {players.map(p => (
                              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                                <input type="checkbox" checked={teams[t].includes(p.id)}
                                  onChange={() => assignTeam(p.id, t)} />
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
                            color: '#ef4444', fontWeight: 400,
                          }}>전체 해제</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
                          const sel   = (gameHoles[g] ?? []).includes(h)
                          const owner = !sel ? getHoleOwner(h, g) : null
                          return (
                            <button key={h} onClick={() => toggleHole(g, h)} style={{
                              width: 36, height: 36, borderRadius: 8, border: 'none', cursor: owner ? 'not-allowed' : 'pointer',
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

          {/* ② 홀 파 설정 */}
          {step === 'pars' && (
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 4 }}>홀별 파 설정</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>총 파: {holePars.reduce((s,p) => s+p, 0)}</p>
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
                              background: holePars[idx] === p ? (p === 3 ? 'var(--blue)' : p === 4 ? 'var(--green)' : 'var(--yellow)') : 'var(--border)',
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

          {/* ③ 판돈 설정 */}
          {step === 'money' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 게임별 판돈 */}
              {Array.from(selGames).map(g => {
                const val      = gameBets[g] ?? 10000
                const bStep    = betSteps[g] ?? 10000
                const setVal   = (n: number) => setGameBets(prev => ({ ...prev, [g]: Math.max(0, n) }))
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
                        onChange={e => {
                          const raw = e.target.value.replace(/,/g, '').replace(/\D/g, '')
                          setVal(raw === '' ? 0 : Number(raw))
                        }}
                        onFocus={e => e.target.select()}
                        style={{ flex: 1, minWidth: 0 }} />
                      <button onClick={() => setVal(val - bStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                      <button onClick={() => setVal(val + bStep)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                    </div>
                  </div>
                )
              })}

              {/* 납부액 */}
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
                {players.map(p => {
                  const val = initAmounts[p.id] ?? 0
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
                {players.every(p => (initAmounts[p.id] ?? 0) > 0) && !amountConfirmed && (
                  <button
                    className="btn btn-green"
                    style={{ marginTop: 4 }}
                    onClick={async () => {
                      await savePlayerAmounts(roomId, initAmounts)
                      const total = players.reduce((s, p) => s + (initAmounts[p.id] ?? 0), 0)
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

          {/* ④ 기타 (OECD + 버디설정) */}
          {step === 'extras' && (
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
                      onChange={e => setBuddy(prev => ({
                        ...prev, enabled: e.target.checked,
                        baseDistribution: e.target.checked && !prev.baseDistribution ? 10000 : prev.baseDistribution,
                        buddyValue: e.target.checked && !prev.buddyValue ? 10000 : prev.buddyValue,
                      }))} />
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

          {/* 게임 시작 버튼 */}
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <button className="btn btn-green" onClick={handleStart} disabled={selGames.size === 0}>
                게임 시작 ({selGames.size}개 게임 선택됨)
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
