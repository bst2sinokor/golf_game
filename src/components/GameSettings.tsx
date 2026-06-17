'use client'
import { useState, useEffect } from 'react'
import { saveConfig, savePlayerAmounts, removePlayer, setPlayerOrder } from '@/lib/roomStore'
import type { Room, GameConfig, GameType, RoomConfig, OecdConfig, BuddyConfig, EventConfig } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'
import { GAME_DETAIL, EVENT_DETAIL, EVENT_COLOR } from '@/lib/gameInfo'
import { orderedPlayerIds } from '@/lib/gameLogic'
import GuideText, { GAME_COLOR } from './GuideText'

const ALL_GAMES: GameType[] = ['stroke', 'jopok', 'lasvegas', 'team-match', 'jootanwootan', 'hussein', 'scratch', 'sinperio']

const GAME_DESC: Record<GameType, string> = {
  stroke:       '홀별 최저 타수 승자가 상금 획득',
  'team-match': '사전 팀 구성, 홀별 팀 합산 타수 비교',
  jootanwootan: '티샷 방향(좌/우)으로 매 홀 팀 구성',
  hussein:      '직전 홀 2등(후세인) vs 연합군 대결',
  lasvegas:     '직전 홀 1위+4위 vs 2위+3위 팀 대결',
  sinperio:     '18홀 전체 적용 · 종료 후 핸디캡 정산',
  scratch:      '타수 차이만큼 금액을 서로 주고받음',
  jopok:        '18홀 단독 진행 · 스킨스 + 벌칙/강탈',
}

interface Props {
  room: Room
  roomId: string
  myId: string
}

type SettingsStep = 'players' | 'games' | 'pars' | 'money' | 'oecd'

export default function GameSettings({ room, roomId, myId }: Props) {
  // ── 플레이어 순서 (playerOrder 기반, 기본 순서는 전 기기 동일) ──
  const orderedIds = orderedPlayerIds(room)
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
    ...( room.config.buddy ?? { enabled: true, baseDistribution: 10000, buddyValue: 10000 })
  }))
  const [nearest, setNearest] = useState<EventConfig>(() => ({
    ...( room.config.nearest ?? { enabled: false, holes: [], amount: 10000 })
  }))
  const [longest, setLongest] = useState<EventConfig>(() => ({
    ...( room.config.longest ?? { enabled: false, holes: [], amount: 10000 })
  }))
  const [teamCarryKeep, setTeamCarryKeep] = useState(room.config.teamCarryKeep ?? true)
  const [teamAssign, setTeamAssign] = useState<'host' | 'random'>(room.config.teamAssign ?? 'random')
  const [husseinMode, setHusseinMode] = useState<'134' | '13'>(room.config.husseinMode ?? '134')
  const [jopokPenalty, setJopokPenalty] = useState<'double' | 'par3strict'>(room.config.jopokPenalty ?? 'double')
  // 3인 이하면 '최하위 1명 제외'(13)는 불가 → 연합군 전원(134)으로 되돌림
  useEffect(() => {
    if (orderedIds.length <= 3 && husseinMode === '13') setHusseinMode('134')
  }, [orderedIds.length, husseinMode])
  const [betSteps, setBetSteps] = useState<Record<string, number>>({})
  const [amountStep, setAmountStep] = useState(100000)
  const [amountConfirmed, setAmountConfirmed] = useState(() =>
    Object.values(room.players).every(p => (p.initialAmount ?? 0) > 0)
  )
  const [confirmedTotal, setConfirmedTotal] = useState(() =>
    Object.values(room.players).reduce((s, p) => s + (p.initialAmount ?? 0), 0)
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // 게임 상세 설명 팝업
  const [detail, setDetail] = useState<{ label: string; color: string; text: string } | null>(null)

  // ── 헬퍼 ──
  function getHoleOwner(hole: number, excludeGame: GameType): GameType | null {
    for (const g of Array.from(selGames)) {
      if (g === excludeGame || g === 'sinperio') continue
      if ((gameHoles[g] ?? []).includes(hole)) return g
    }
    return null
  }

  function toggleGame(g: GameType) {
    const next = new Set(selGames)
    if (next.has(g)) {
      next.delete(g)
      if (g === 'jopok') setGameHoles(prev => ({ ...prev, jopok: [] }))
    } else {
      next.add(g)
      if (g === 'jopok') setGameHoles(prev => ({ ...prev, jopok: Array.from({ length: 18 }, (_, i) => i + 1) }))
      else if (!gameHoles[g]) setGameHoles(prev => ({ ...prev, [g]: [] }))
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
        holes: (type === 'sinperio' || type === 'jopok')
          ? Array.from({ length: 18 }, (_, i) => i + 1)
          : gameHoles[type] ?? Array.from({ length: 18 }, (_, i) => i + 1),
      }
      if (type === 'scratch')       cfg.betPerStroke = gameBets[type] ?? 1000
      else if (type === 'sinperio') cfg.totalBet      = gameBets[type] ?? 1000
      else                          cfg.betPerHole    = gameBets[type] ?? 5000
      if (type === 'team-match')    cfg.teams         = teams
      return cfg
    })
    const config: RoomConfig = {
      holePars, games, oecd, buddy, nearest, longest, teamCarryKeep, teamAssign, husseinMode, jopokPenalty,
      ...(room.config.courseNames ? { courseNames: room.config.courseNames } : {}),
    }
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

  function movePlayer(playerId: string, dir: -1 | 1) {
    const ids = orderedPlayers.map(p => p.id)
    const idx = ids.indexOf(playerId)
    const to = idx + dir
    if (to < 0 || to >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setPlayerOrder(roomId, next)
  }


  // ── 렌더 ──
  const STEP_LABELS: Record<SettingsStep, string> = {
    players: '플레이어', pars: '코스설정', oecd: '기본설정', games: '게임선택', money: '금액설정',
  }

  return (
    <div>
      {/* 게임 상세 설명 팝업 */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, overflow: 'hidden',
            width: '100%', maxWidth: 360, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', background: detail.color }}>
              <span style={{
                width: 22, height: 22, borderRadius: 7, background: 'rgba(255,255,255,.25)', color: '#fff',
                fontSize: 12, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{detail.label[0]}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{detail.label}</span>
            </div>
            <div style={{ padding: '14px 16px', overflowY: 'auto' }}>
              <GuideText text={detail.text} accent={detail.color} />
            </div>
            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-blue" onClick={() => setDetail(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

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
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>▲▼ 버튼으로 순서 변경</p>
          {orderedPlayers.map((p, pi) => (
            <div key={p.id}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 8px', borderRadius: 8, marginBottom: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: p.id === myId ? 800 : 600 }}>{p.name}</span>
                  {p.id === myId && (
                    <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700 }}>(진행자)</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={e => { e.stopPropagation(); movePlayer(p.id, -1) }} disabled={pi === 0} style={{
                    width: 32, height: 32, borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg)', fontSize: 14, fontWeight: 700, cursor: pi === 0 ? 'default' : 'pointer',
                    color: pi === 0 ? '#cbd5e1' : 'var(--blue)',
                  }}>▲</button>
                  <button onClick={e => { e.stopPropagation(); movePlayer(p.id, 1) }} disabled={pi === orderedPlayers.length - 1} style={{
                    width: 32, height: 32, borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg)', fontSize: 14, fontWeight: 700, cursor: pi === orderedPlayers.length - 1 ? 'default' : 'pointer',
                    color: pi === orderedPlayers.length - 1 ? '#cbd5e1' : 'var(--blue)',
                  }}>▼</button>
                  {p.id !== myId ? (
                    <button onClick={e => { e.stopPropagation(); handleRemove(p.id) }} style={{
                      width: 48, height: 32, borderRadius: 6, border: '1px solid #fca5a5',
                      background: '#fef2f2', color: '#dc2626', fontSize: 12,
                      fontWeight: 600, cursor: 'pointer',
                    }}>
                      삭제
                    </button>
                  ) : (
                    <span style={{ width: 48, height: 32, flexShrink: 0 }} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ② 게임 선택 */}
      {step === 'games' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ALL_GAMES.map(g => {
            // 4인 미만이면 팀 게임(라스베가스·팀매치·좌탄우탄)은 새로 선택 불가
            const teamGame = g === 'lasvegas' || g === 'team-match' || g === 'jootanwootan'
            // 조폭은 18홀 단독 → 다른 '메인' 게임과 배타. 단, 신페리오·니어·롱기는 병행 가능.
            const jopokSelected = selGames.has('jopok')
            const anyMainOther = ALL_GAMES.some(x => x !== 'jopok' && x !== 'sinperio' && selGames.has(x))
            let blocked = teamGame && orderedPlayers.length < 4 && !selGames.has(g)
            if (g === 'jopok' && !jopokSelected && anyMainOther) blocked = true
            if (g !== 'jopok' && g !== 'sinperio' && !selGames.has(g) && jopokSelected) blocked = true
            return (
            <div key={g}>
              {/* 신페리오: 추가 옵션으로 분리 */}
              {g === 'sinperio' && (
                <div style={{ margin: '14px 0 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
                    <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '.8px', color: 'var(--blue)', flexShrink: 0 }}>Additional Option</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, marginBottom: 8, paddingLeft: 16 }}>
                    위 게임들과 <span style={{ color: 'var(--blue)', fontWeight: 800 }}>병행하여 진행</span>할 수 있는 옵션입니다.
                  </p>
                </div>
              )}
              <div className="card" onClick={() => { if (!blocked) toggleGame(g) }} style={{
                cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1,
                border: selGames.has(g) ? '2px solid var(--green)' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 2 }}>
                      {GAME_LABELS[g]}
                      <button onClick={e => { e.stopPropagation(); setDetail({ label: GAME_LABELS[g], color: GAME_COLOR[g], text: GAME_DETAIL[g] }) }} style={{
                        width: 18, height: 18, borderRadius: '50%', border: '1.5px solid var(--muted)',
                        background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                        fontSize: 11, fontWeight: 800, lineHeight: 1, padding: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>?</button>
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {g === 'jopok'
                        ? <><span style={{ color: '#dc2626', fontWeight: 800 }}>18홀 단독 진행</span>{' · 스킨스 + 벌칙/강탈'}</>
                        : GAME_DESC[g]}
                      {blocked && (
                        <span style={{ color: '#dc2626', fontWeight: 800 }}>
                          {' · '}{g === 'jopok' ? '다른 게임 해제 후 선택 가능'
                            : jopokSelected ? '조폭 해제 후 선택 가능'
                            : '4인 필수'}
                        </span>
                      )}
                    </p>
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
                        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 6, color: i === 0 ? '#2563eb' : '#16a34a' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: i === 0 ? '#2563eb' : '#16a34a', flexShrink: 0 }} />
                          팀
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

              {/* 후세인: 대결 방식 */}
              {selGames.has(g) && g === 'hussein' && (
                <div className="card" style={{ marginTop: 8, background: 'var(--bg)' }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>대결 방식</p>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[{ v: '134' as const, l: '연합군 전원' }, { v: '13' as const, l: '최하위 1명 제외' }].map(({ v, l }) => {
                      const disabled = v === '13' && orderedPlayers.length <= 3
                      return (
                      <button key={v} disabled={disabled} onClick={() => { if (!disabled) setHusseinMode(v) }} style={{
                        flex: 1, padding: '8px 2px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700,
                        border: '1px solid var(--border)', opacity: disabled ? 0.4 : 1,
                        background: husseinMode === v ? 'var(--blue)' : 'var(--card)',
                        color: husseinMode === v ? '#fff' : 'var(--muted)',
                      }}>{l}</button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
                    {orderedPlayers.length <= 3
                      ? '후세인 점수 vs 연합군 전원 타수 합. (최하위 1명 제외는 4인 필수)'
                      : husseinMode === '13'
                      ? '후세인 점수 vs 연합군 합 — 단, 그 홀에서 가장 못 친 연합군 1명은 제외하고 합산. 후세인 점수는 비교 인원수만큼 곱함. 상금은 동일(승리 시 인원수만큼 독식, 패배 시 전원 지급)'
                      : '후세인 점수 ×3 vs 연합군 3명 타수 합. 승리 시 ×3 독식, 패배 시 전원 지급'}
                  </p>
                </div>
              )}

              {/* 조폭: 반납 강도 + 18홀 단독 안내 */}
              {selGames.has(g) && g === 'jopok' && (
                <div className="card" style={{ marginTop: 8, background: 'var(--bg)' }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>벌칙(반납) 강도</p>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[{ v: 'double' as const, l: '더블50% / 트리플100%' }, { v: 'par3strict' as const, l: '기본+파3만 한단계 엄격' }].map(({ v, l }) => (
                      <button key={v} onClick={() => setJopokPenalty(v)} style={{
                        flex: 1, padding: '8px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                        border: '1px solid var(--border)',
                        background: jopokPenalty === v ? 'var(--blue)' : 'var(--card)',
                        color: jopokPenalty === v ? '#fff' : 'var(--muted)',
                      }}>{l}</button>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
                    {jopokPenalty === 'par3strict'
                      ? '파4·5: 더블=누적 보유금 50%, 트리플+=100% 반납 / 파3: 보기=50%, 더블+=100% 반납. 반납액은 홀 설정금액 단위로 올림.'
                      : '모든 홀: 더블=누적 보유금 50%, 트리플+=100% 반납. 반납액은 홀 설정금액 단위로 올림.'}
                    {' '}버디 시 나머지 전원 보유금 강탈. 반납금은 그 홀 승자가 독식.
                  </p>
                  <p style={{ fontSize: 11, color: '#b45309', marginTop: 6, lineHeight: 1.5, fontWeight: 600 }}>
                    18홀 전체에 단독으로 적용돼요(다른 메인 게임과 함께 불가). 기본배분은 적용, 버디값은 미적용.
                  </p>
                </div>
              )}

              {/* 적용 홀 선택 (신페리오·조폭은 전체 홀 고정) */}
              {selGames.has(g) && g !== 'sinperio' && g !== 'jopok' && (
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
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                        }} title={owner ? `${GAME_LABELS[owner]}에 배정됨` : undefined}>
                          <span>{h}</span>
                          {/* 파 표시: 파3 점, 파4 없음, 파5 - */}
                          <span style={{ height: 6, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {holePars[h - 1] === 3 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />}
                            {holePars[h - 1] === 5 && <span style={{ width: 14, height: 3, borderRadius: 2, background: 'currentColor' }} />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            )
          })}

          {/* 니어·롱기스트 설정 */}
          {([
            { key: 'nearest' as const, label: '니어리스트', desc: '온그린 핀 최근접자 Par 이상 시 상금', cfg: nearest, setCfg: setNearest },
            { key: 'longest' as const, label: '롱기스트',   desc: '페어웨이 안착 최장타자 상금',       cfg: longest, setCfg: setLongest },
          ]).map(({ key, label, desc, cfg, setCfg }) => (
            <div key={key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                    {label} 설정
                    <button onClick={() => setDetail({ label, color: EVENT_COLOR[key], text: EVENT_DETAIL[key] })} style={{
                      width: 18, height: 18, borderRadius: '50%', border: '1.5px solid var(--muted)',
                      background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                      fontSize: 11, fontWeight: 800, lineHeight: 1, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>?</button>
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{desc}</p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cfg.enabled}
                    onChange={e => setCfg(prev => ({ ...prev, enabled: e.target.checked }))} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>활성화</span>
                </label>
              </div>
              {cfg.enabled && (
                <>
                  <div className="divider" />
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>적용 홀</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
                        const sel = cfg.holes.includes(h)
                        return (
                          <button key={h} onClick={() => setCfg(prev => ({
                            ...prev,
                            holes: prev.holes.includes(h) ? prev.holes.filter(x => x !== h) : [...prev.holes, h].sort((a, b) => a - b),
                          }))} style={{
                            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                            fontWeight: 700, fontSize: 13,
                            background: sel ? '#d97706' : 'var(--border)',
                            color: sel ? '#fff' : 'var(--muted)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                          }}>
                            <span>{h}</span>
                            <span style={{ height: 6, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {holePars[h - 1] === 3 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />}
                              {holePars[h - 1] === 5 && <span style={{ width: 14, height: 3, borderRadius: 2, background: 'currentColor' }} />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>당첨 금액 (원)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="text" inputMode="numeric"
                        value={cfg.amount === 0 ? '' : cfg.amount.toLocaleString()}
                        onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setCfg(prev => ({ ...prev, amount: raw === '' ? 0 : Number(raw) })) }}
                        onFocus={e => e.target.select()}
                        style={{ flex: 1, minWidth: 0 }} />
                      <button onClick={() => setCfg(prev => ({ ...prev, amount: Math.max(0, prev.amount - 5000) }))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                      <button onClick={() => setCfg(prev => ({ ...prev, amount: prev.amount + 5000 }))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ③ 홀 파 설정 */}
      {step === 'pars' && (
        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 12 }}>
            홀별 파 설정 <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
              (총 파: {holePars.reduce((s, p) => s + p, 0)}타)
            </span>
          </p>
          {[
            room.config.courseNames ? `전반 (${room.config.courseNames.front})` : '전반 (1~9홀)',
            room.config.courseNames ? `후반 (${room.config.courseNames.back})` : '후반 (10~18홀)',
          ].map((label, half) => (
            <div key={half} style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{label}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 4 }}>
                {Array.from({ length: 9 }, (_, i) => i + half * 9).map(idx => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{idx + 1}홀</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                      {[3, 4, 5].map(p => (
                        <button key={p} onClick={() => setHolePars(prev => { const n = [...prev]; n[idx] = p; return n })} style={{
                          width: '100%', height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
                          fontSize: 12, fontWeight: 600, padding: 0,
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
                {/* 단위 선택 (스크래치·신페리오만: 타당 금액이라 소액 단위 필요) */}
                {(g === 'scratch' || g === 'sinperio') && (
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
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="text" inputMode="numeric"
                    value={val === 0 ? '' : val.toLocaleString()}
                    onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setVal(raw === '' ? 0 : Number(raw)) }}
                    onFocus={e => e.target.select()}
                    style={{ flex: 1, minWidth: 0 }} />
                  <button onClick={() => setVal(val - (g === 'scratch' || g === 'sinperio' ? bStep : 5000))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                  <button onClick={() => setVal(val + (g === 'scratch' || g === 'sinperio' ? bStep : 5000))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
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

      {/* ⑤ 기본설정 (OECD + 버디설정) */}
      {step === 'oecd' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 기본금액 분배 설정 (버디와 독립) */}
          <div className="card">
            <p style={{ fontWeight: 700, marginBottom: 2 }}>기본금액 분배</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>첫 홀 시작 시 각 플레이어 지갑에 지급 (0 = 미적용)</p>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>분배 금액 (원/인)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="text" inputMode="numeric"
                value={(buddy.baseDistribution ?? 0) === 0 ? '' : buddy.baseDistribution.toLocaleString()}
                onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setBuddy(prev => ({ ...prev, baseDistribution: raw === '' ? 0 : Number(raw) })) }}
                onFocus={e => e.target.select()}
                style={{ flex: 1, minWidth: 0 }} />
              <button onClick={() => setBuddy(prev => ({ ...prev, baseDistribution: Math.max(0, (prev.baseDistribution ?? 0) - 5000) }))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
              <button onClick={() => setBuddy(prev => ({ ...prev, baseDistribution: (prev.baseDistribution ?? 0) + 5000 }))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
            </div>
          </div>

          {/* 팀/역할 미정 시 배정 방식 */}
          <div className="card">
            <p style={{ fontWeight: 700, marginBottom: 2 }}>팀 구성 미정 시</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>라스베가스·후세인 팀/역할이 정해지지 않을 때 (예: 첫 홀)</p>
            <div style={{ display: 'flex', gap: 5 }}>
              {[{ v: 'host' as const, l: '진행자 배정' }, { v: 'random' as const, l: 'A.I 랜덤배정' }].map(({ v, l }) => (
                <button key={v} onClick={() => setTeamAssign(v)} style={{
                  flex: 1, padding: '8px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  border: '1px solid var(--border)',
                  background: teamAssign === v ? 'var(--blue)' : 'var(--bg)',
                  color: teamAssign === v ? '#fff' : 'var(--muted)',
                }}>{l}</button>
              ))}
            </div>
          </div>

          {/* 팀게임 이월 시 팀 구성 */}
          <div className="card">
            <p style={{ fontWeight: 700, marginBottom: 2 }}>팀게임 이월시 다음게임 팀구성</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>무승부로 상금 이월 시 다음 홀 팀 구성 (좌탄우탄·라스베가스)</p>
            <div style={{ display: 'flex', gap: 5 }}>
              {[{ v: true, l: '팀 유지' }, { v: false, l: '팀 재구성' }].map(({ v, l }) => (
                <button key={l} onClick={() => setTeamCarryKeep(v)} style={{
                  flex: 1, padding: '8px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  border: '1px solid var(--border)',
                  background: teamCarryKeep === v ? 'var(--blue)' : 'var(--bg)',
                  color: teamCarryKeep === v ? '#fff' : 'var(--muted)',
                }}>{l}</button>
              ))}
            </div>
          </div>

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
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>18홀(마지막홀) OECD</label>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[{ v: true, l: '해제' }, { v: false, l: '유지' }].map(({ v, l }) => (
                      <button key={l} onClick={() => setOecd(prev => ({ ...prev, lastHoleRelease: v }))} style={{
                        flex: 1, padding: '8px 2px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                        border: '1px solid var(--border)',
                        background: (oecd.lastHoleRelease ?? true) === v ? 'var(--blue)' : 'var(--bg)',
                        color: (oecd.lastHoleRelease ?? true) === v ? '#fff' : 'var(--muted)',
                      }}>{l}</button>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    해제 시 18홀에서는 OECD 페널티가 적용되지 않습니다
                  </p>
                </div>
                {[
                  { key: 'threshold',       label: 'OECD 가입 기준 (원)'   },
                  { key: 'penaltyPerEvent', label: '이벤트당 페널티 (원)'   },
                  { key: 'maxPerHole',      label: '홀당 페널티 상한 (원)' },
                ].map(({ key, label }) => {
                  const val    = oecd[key as keyof OecdConfig] as number
                  const setVal = (n: number) => setOecd(prev => ({ ...prev, [key]: Math.max(0, n) }))
                  return (
                    <div key={key}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 6 }}>{label}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="text" inputMode="numeric"
                          value={val === 0 ? '' : val.toLocaleString()}
                          onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setVal(raw === '' ? 0 : Number(raw)) }}
                          onFocus={e => e.target.select()}
                          style={{ flex: 1, minWidth: 0 }} />
                        <button onClick={() => setVal(val - 5000)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                        <button onClick={() => setVal(val + 5000)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {/* 버디 설정 */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 700 }}>버디값 설정</p>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>버디 달성 시 보너스</p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={buddy.enabled}
                  onChange={e => setBuddy(prev => ({
                    ...prev, enabled: e.target.checked,
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
                  { key: 'buddyValue',        label: '버디값 (원/인)',         desc: '버디 달성 시 나머지 플레이어 각 인당 지급' },
                ] as { key: keyof BuddyConfig; label: string; desc: string }[]).map(({ key, label, desc }) => {
                  const val    = buddy[key] as number
                  const setVal = (n: number) => setBuddy(prev => ({ ...prev, [key]: Math.max(0, n) }))
                  return (
                    <div key={key as string}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', display: 'block', marginBottom: 2 }}>{label}</label>
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{desc}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="text" inputMode="numeric"
                          value={val === 0 ? '' : val.toLocaleString()}
                          onChange={e => { const raw = e.target.value.replace(/,/g, '').replace(/\D/g, ''); setVal(raw === '' ? 0 : Number(raw)) }}
                          onFocus={e => e.target.select()}
                          style={{ flex: 1, minWidth: 0 }} />
                        <button onClick={() => setVal(val - 5000)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                        <button onClick={() => setVal(val + 5000)} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
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
