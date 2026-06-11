'use client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom, saveConfig, startGame } from '@/lib/roomStore'
import type { Room, GameConfig, GameType, RoomConfig, OecdConfig } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'

const ALL_GAMES: GameType[] = ['stroke', 'team-match', 'jootanwootan', 'hussein', 'sinperio', 'scratch']
const GAME_DESC: Record<GameType, string> = {
  stroke:       '홀별 최저 타수 승자가 판돈 획득',
  'team-match': '사전 팀 구성, 홀별 팀 합산 타수 비교',
  jootanwootan: '티샷 방향(좌/우)으로 매 홀 팀 구성',
  hussein:      '직전 홀 2등 vs 1·3·4등 대결',
  sinperio:     '18홀 완료 후 핸디캡 적용 개인 정산',
  scratch:      '타수 차이만큼 금액을 서로 주고받음',
}

const DEFAULT_PAR = [4,3,4,4,5,3,4,5,4, 4,3,4,4,5,3,4,5,4]

export default function SetupPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom]     = useState<Room | null>(null)
  const [myId, setMyId]     = useState('')
  const [step, setStep]     = useState<'games' | 'pars' | 'money' | 'oecd'>('games')

  // 선택 게임
  const [selGames, setSelGames] = useState<Set<GameType>>(new Set())
  // 게임별 적용 홀 (기본 전체)
  const [gameHoles, setGameHoles] = useState<Record<GameType, number[]>>({} as Record<GameType, number[]>)
  // 게임별 판돈
  const [gameBets, setGameBets] = useState<Record<GameType, number>>({} as Record<GameType, number>)
  // 팀 구성 (team-match)
  const [teams, setTeams] = useState<[string[], string[]]>([[], []])
  // 홀별 파
  const [holePars, setHolePars] = useState<number[]>(DEFAULT_PAR)
  // 기본금액
  const [initAmounts, setInitAmounts] = useState<Record<string, number>>({})
  // OECD
  const [oecd, setOecd] = useState<OecdConfig>({
    enabled: false, threshold: 60000, penaltyPerEvent: 10000, maxPerHole: 20000,
  })

  useEffect(() => {
    const pid = localStorage.getItem('golf_player') ?? ''
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
      if (!gameHoles[g]) setGameHoles(prev => ({ ...prev, [g]: Array.from({ length: 18 }, (_, i) => i + 1) }))
      if (!gameBets[g])  setGameBets(prev => ({ ...prev, [g]: 5000 }))
    }
    setSelGames(next)
  }

  function toggleHole(game: GameType, hole: number) {
    setGameHoles(prev => {
      const cur = prev[game] ?? []
      return { ...prev, [game]: cur.includes(hole) ? cur.filter(h => h !== hole) : [...cur, hole].sort((a,b)=>a-b) }
    })
  }

  function assignTeam(playerId: string, team: 0 | 1) {
    setTeams(prev => {
      const t0 = prev[0].filter(id => id !== playerId)
      const t1 = prev[1].filter(id => id !== playerId)
      if (team === 0) return [[...t0, playerId], t1]
      return [t0, [...t1, playerId]]
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
      else if (type === 'sinperio') cfg.totalBet  = gameBets[type] ?? 50000
      else                      cfg.betPerHole   = gameBets[type] ?? 5000
      if (type === 'team-match') cfg.teams = teams
      return cfg
    })

    const config: RoomConfig = { holePars, games, oecd }

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
        <span style={{ fontSize: 24 }}>⛳</span>
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
            {(['games', 'pars', 'money', 'oecd'] as const).map((s, i) => (
              <button key={s} onClick={() => setStep(s)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: step === s ? 'var(--blue)' : 'var(--card)',
                color: step === s ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>
                {['게임선택', '홀파설정', '판돈설정', 'OECD'][i]}
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
                    <div className="card" style={{ marginTop: 8, background: '#0f172a' }}>
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>팀 구성</p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[0, 1].map(t => (
                          <div key={t} style={{ flex: 1, padding: 10, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}>
                            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: t === 0 ? '#60a5fa' : '#f87171' }}>
                              {t === 0 ? '🔵 팀 A' : '🔴 팀 B'}
                            </p>
                            {players.map(p => (
                              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
                                <input type="checkbox" checked={teams[t].includes(p.id)}
                                  onChange={() => assignTeam(p.id, t as 0|1)} />
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
                    <div className="card" style={{ marginTop: 8, background: '#0f172a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <p style={{ fontSize: 13, color: 'var(--muted)' }}>적용 홀</p>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => setGameHoles(p => ({ ...p, [g]: Array.from({ length: 18 }, (_, i) => i + 1) }))}
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>전체</button>
                          <button onClick={() => setGameHoles(p => ({ ...p, [g]: Array.from({ length: 9 }, (_, i) => i + 1) }))}
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>전반</button>
                          <button onClick={() => setGameHoles(p => ({ ...p, [g]: Array.from({ length: 9 }, (_, i) => i + 10) }))}
                            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>후반</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
                          const sel = (gameHoles[g] ?? []).includes(h)
                          return (
                            <button key={h} onClick={() => toggleHole(g, h)} style={{
                              width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                              fontWeight: 700, fontSize: 13,
                              background: sel ? 'var(--green)' : 'var(--border)',
                              color: sel ? '#fff' : 'var(--muted)',
                            }}>{h}</button>
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
              {Array.from(selGames).map(g => (
                <div key={g} className="card">
                  <p style={{ fontWeight: 700, marginBottom: 8 }}>{GAME_LABELS[g]}</p>
                  <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    {g === 'scratch' ? '타당 금액 (원)' : g === 'sinperio' ? '총 판돈 (원)' : '홀당 금액 (원)'}
                  </label>
                  <input type="number" value={gameBets[g] ?? 5000}
                    onChange={e => setGameBets(prev => ({ ...prev, [g]: Number(e.target.value) }))}
                    step={1000} min={0} />
                </div>
              ))}

              {/* 기본 금액 */}
              <div className="card">
                <p style={{ fontWeight: 700, marginBottom: 4 }}>참가자 기본 금액</p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>실시간 잔액 표시 기준</p>
                {players.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ minWidth: 60, fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <input type="number" value={initAmounts[p.id] ?? 0}
                      onChange={e => setInitAmounts(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                      step={10000} min={0} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ④ OECD 설정 */}
          {step === 'oecd' && (
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
                    { key: 'threshold',      label: 'OECD 가입 기준 (원)',   step: 10000 },
                    { key: 'penaltyPerEvent',label: '이벤트당 페널티 (원)',   step: 1000  },
                    { key: 'maxPerHole',     label: '홀당 페널티 상한 (원)', step: 5000  },
                  ].map(({ key, label, step }) => (
                    <div key={key}>
                      <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                      <input type="number" value={oecd[key as keyof OecdConfig] as number}
                        onChange={e => setOecd(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                        step={step} min={0} />
                    </div>
                  ))}
                  <div style={{ padding: 10, background: '#0f172a', borderRadius: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                    <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>페널티 이벤트</p>
                    OB · 해저드 · 벙커 · 3퍼팅 · 트리플이상 (파3: 더블이상)<br />
                    각 이벤트마다 {oecd.penaltyPerEvent.toLocaleString()}원, 홀당 최대 {oecd.maxPerHole.toLocaleString()}원
                  </div>
                </>
              )}
            </div>
          )}

          {/* 게임 시작 버튼 */}
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <button className="btn btn-green" onClick={handleStart} disabled={selGames.size === 0}>
                ⛳ 게임 시작 ({selGames.size}개 게임 선택됨)
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
