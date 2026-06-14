'use client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom, fetchRoomFromServer, saveConfig, startGame, savePlayerAmounts, saveCoursePreset, fetchCoursePresets, saveCourseCombo, fetchCourseCombos, type CoursePreset, type CourseCombo } from '@/lib/roomStore'
import type { Room, GameConfig, GameType, RoomConfig, OecdConfig, BuddyConfig, EventConfig } from '@/lib/types'
import { GAME_LABELS } from '@/lib/types'
import { GAME_DETAIL } from '@/lib/gameInfo'
import { orderedPlayerIds } from '@/lib/gameLogic'

const ALL_GAMES: GameType[] = ['stroke', 'lasvegas', 'team-match', 'jootanwootan', 'hussein', 'scratch', 'jopok', 'sinperio']
const GAME_DESC: Record<GameType, string> = {
  stroke:       '홀별 최저 타수 승자가 판돈 획득',
  'team-match': '사전 팀 구성, 홀별 팀 합산 타수 비교',
  jootanwootan: '티샷 방향(좌/우)으로 매 홀 팀 구성',
  hussein:      '직전 홀 2등 vs 나머지 대결 (1·3·4등 / 1·3등 선택)',
  lasvegas:     '직전 홀 1위+4위 vs 2위+3위 팀 대결 (4인 전용)',
  sinperio:     '타 게임과 중복 진행 · 18홀 전체 적용 · 종료 후 핸디캡 정산',
  scratch:      '타수 차이만큼 금액을 서로 주고받음',
  jopok:        '스킨스 + 벌칙/강탈 · 18홀 단독 진행 (다른 게임과 함께 불가)',
}

const DEFAULT_PAR = Array(18).fill(0)  // 0 = 미선택 (확정 시 프리셋 또는 파4로 채움)

export default function SetupPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom]     = useState<Room | null>(null)
  const [myId, setMyId]     = useState('')
  const [step, setStep]     = useState<'games' | 'pars' | 'money' | 'extras'>('pars')

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
  // 골프장·코스 (전반/후반 9홀 코스 단위 프리셋)
  const [club, setClub]               = useState('')
  const [frontCourse, setFrontCourse] = useState('')
  const [backCourse, setBackCourse]   = useState('')
  const [presets, setPresets]         = useState<CoursePreset[]>([])
  const [combos, setCombos]           = useState<CourseCombo[]>([])
  const [courseConfirmed, setCourseConfirmed] = useState(false)
  const [courseMsg, setCourseMsg]     = useState('')
  // 기본금액
  const [initAmounts, setInitAmounts] = useState<Record<string, number>>({})
  // OECD
  const [oecd, setOecd] = useState<OecdConfig>({
    enabled: false, lastHoleRelease: true, threshold: 60000, penaltyPerEvent: 10000, maxPerHole: 20000,
  })
  // 버디
  const [buddy, setBuddy] = useState<BuddyConfig>({
    enabled: false, baseDistribution: 10000, buddyValue: 0, collectFromTeammates: false,
  })
  // 니어·롱기스트
  const [nearest, setNearest] = useState<EventConfig>({ enabled: false, holes: [], amount: 10000 })
  const [longest, setLongest] = useState<EventConfig>({ enabled: false, holes: [], amount: 10000 })
  // 팀게임 이월 시 팀 유지 여부 (기본 팀 유지)
  const [teamCarryKeep, setTeamCarryKeep] = useState(true)
  // 팀/역할 미정 시 배정 방식 (기본 진행자 배정)
  const [teamAssign, setTeamAssign] = useState<'host' | 'random'>('random')
  // 후세인 대결 방식 (기본 1·3·4등)
  const [husseinMode, setHusseinMode] = useState<'134' | '13'>('134')
  // 조폭 반납 강도 (기본 더블50/트리플100)
  const [jopokPenalty, setJopokPenalty] = useState<'double' | 'par3strict'>('double')
  // 게임 상세 설명 팝업
  const [detailGame, setDetailGame] = useState<GameType | null>(null)
  // 판돈 단위
  const [betSteps, setBetSteps] = useState<Record<string, number>>({})
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
    // 모바일 절전 복귀 시 서버에서 강제 동기화
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      fetchRoomFromServer(roomId).then(r => { if (r) setRoom(r) })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId])

  // 스텝 변경 시 화면 맨 위로 스크롤
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  // 코스 프리셋·조합 로드
  useEffect(() => {
    fetchCoursePresets().then(setPresets)
    fetchCourseCombos().then(setCombos)
  }, [])

  // 코스 적용: 저장된 코스면 홀별 파 적용, 없는 코스면 파4 기본 + 입력 안내
  function applyCourse(c: string, f: string, b: string) {
    if (!c.trim() || !f.trim() || !b.trim()) {
      setCourseMsg('골프장과 전반·후반 코스 이름을 모두 입력해주세요.')
      return
    }
    const front = presets.find(p => p.club === c.trim() && p.course === f.trim())
    const back  = presets.find(p => p.club === c.trim() && p.course === b.trim())
    const next  = [...holePars]
    const missing: string[] = []
    if (front) next.splice(0, 9, ...front.pars)
    else { next.splice(0, 9, ...Array(9).fill(4)); missing.push(f.trim()) }
    if (back) next.splice(9, 9, ...back.pars)
    else { next.splice(9, 9, ...Array(9).fill(4)); missing.push(b.trim()) }
    setHolePars(next)
    setCourseConfirmed(true)
    setCourseMsg(missing.length > 0
      ? `'${missing.join("', '")}' 코스는 저장된 정보가 없습니다. 홀별 파를 입력해주세요. (기본 파4)`
      : '저장된 홀별 파를 불러왔습니다.')
  }

  // 칩 선택: 골프장+전반+후반 일괄 입력 + 즉시 적용
  function selectCombo(cb: CourseCombo) {
    setClub(cb.club)
    setFrontCourse(cb.frontCourse)
    setBackCourse(cb.backCourse)
    applyCourse(cb.club, cb.frontCourse, cb.backCourse)
  }

  function toggleGame(g: GameType) {
    const next = new Set(selGames)
    if (next.has(g)) {
      next.delete(g)
      if (g === 'jopok') setGameHoles(prev => ({ ...prev, jopok: [] }))
    } else {
      next.add(g)
      // 조폭은 18홀 전체 단독 진행 → 모든 홀 점유 (다른 게임은 홀을 못 잡음)
      if (g === 'jopok') setGameHoles(prev => ({ ...prev, jopok: Array.from({ length: 18 }, (_, i) => i + 1) }))
      else if (!gameHoles[g]) setGameHoles(prev => ({ ...prev, [g]: [] }))
      if (!gameBets[g])  setGameBets(prev => ({ ...prev, [g]: 10000 }))
    }
    setSelGames(next)
  }

  // 해당 홀이 다른 게임에 이미 배정됐는지 확인
  function getHoleOwner(hole: number, excludeGame: GameType): GameType | null {
    for (const g of Array.from(selGames)) {
      if (g === excludeGame || g === 'sinperio') continue
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
        holes: (type === 'sinperio' || type === 'jopok')
          ? Array.from({ length: 18 }, (_, i) => i + 1)
          : gameHoles[type] ?? Array.from({ length: 18 }, (_, i) => i + 1),
      }
      if (type === 'scratch')   cfg.betPerStroke = gameBets[type] ?? 1000
      else if (type === 'sinperio') cfg.totalBet  = gameBets[type] ?? 1000
      else                      cfg.betPerHole   = gameBets[type] ?? 5000
      if (type === 'team-match') cfg.teams = { team1: teams.team1, team2: teams.team2 }
      return cfg
    })

    const config: RoomConfig = {
      holePars, games, oecd, buddy, nearest, longest, teamCarryKeep, teamAssign, husseinMode, jopokPenalty,
      ...(club.trim() && frontCourse.trim() && backCourse.trim()
        ? { courseNames: { club: club.trim(), front: frontCourse.trim(), back: backCourse.trim() } }
        : {}),
    }

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
  const players = orderedPlayerIds(room).map(id => room.players[id]).filter(Boolean)

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 80px' }}>

      {/* 게임 상세 설명 팝업 */}
      {detailGame && (
        <div onClick={() => setDetailGame(null)} style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, padding: '20px 18px',
            width: '100%', maxWidth: 360, maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,.25)',
          }}>
            <p style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{GAME_LABELS[detailGame]}</p>
            <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-line', marginBottom: 16 }}>
              {GAME_DETAIL[detailGame]}
            </p>
            <button className="btn btn-blue" onClick={() => setDetailGame(null)}>닫기</button>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <svg width="50" height="50" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <path d="M24 3 L42 9 L42 24 C42 34 34 41 24 45 C14 41 6 34 6 24 L6 9 Z" fill="#14532d"/>
          <path d="M24 6.5 L39 11.5 L39 24 C39 32.5 32.5 38.5 24 42 C15.5 38.5 9 32.5 9 24 L9 11.5 Z" stroke="#c9a227" strokeWidth="1" fill="none"/>
          <line x1="21" y1="14" x2="21" y2="32" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M21 14 L31 17 L21 20 Z" fill="#fde047"/>
          <circle cx="27" cy="33" r="2" fill="#fff"/>
        </svg>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: '24px', margin: 0 }}>게임 설정</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '22px', marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, color: 'var(--muted)' }}>방 코드</span>
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 2, color: 'var(--green)' }}>{roomId}</span>
            {/* 이미 게임이 시작된 방이면, 실수로 설정 화면에 온 진행자가 다시 플레이 화면으로 */}
            {room.status === 'playing' && (
              <button onClick={() => router.push(`/play/${roomId}`)} style={{
                padding: '4px 11px', borderRadius: 16, cursor: 'pointer', border: 'none',
                background: 'var(--blue)', color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              }}>방으로 돌아가기</button>
            )}
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
            {(['pars', 'extras', 'games', 'money'] as const).map((s, i) => (
              <button key={s} onClick={() => setStep(s)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: step === s ? 'var(--blue)' : 'var(--card)',
                color: step === s ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>
                {['코스설정', '기본설정', '게임선택', '금액설정'][i]}
              </button>
            ))}
          </div>

          {/* ① 게임 선택 */}
          {step === 'games' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ALL_GAMES.map(g => {
                // 4인 미만이면 팀 게임(라스베가스·팀매치·좌탄우탄)은 새로 선택 불가
                const teamGame = g === 'lasvegas' || g === 'team-match' || g === 'jootanwootan'
                // 조폭은 18홀 단독 진행 → 다른 게임과 동시 선택 불가 (상호 배타)
                const jopokSelected = selGames.has('jopok')
                const anyOther = ALL_GAMES.some(x => x !== 'jopok' && selGames.has(x))
                let blocked = teamGame && players.length < 4 && !selGames.has(g)
                if (g === 'jopok' && !jopokSelected && anyOther) blocked = true
                if (g !== 'jopok' && !selGames.has(g) && jopokSelected) blocked = true
                return (
                <div key={g}>
                  {/* 신페리오: 추가 옵션으로 분리 */}
                  {g === 'sinperio' && (
                    <div style={{ margin: '14px 0 2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.8px', color: 'var(--muted)', flexShrink: 0 }}>Additional Option</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, marginBottom: 8, paddingLeft: 16 }}>
                        위 게임들과 중복으로 함께 진행되는 옵션입니다
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
                          <button onClick={e => { e.stopPropagation(); setDetailGame(g) }} style={{
                            width: 18, height: 18, borderRadius: '50%', border: '1.5px solid var(--muted)',
                            background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                            fontSize: 11, fontWeight: 800, lineHeight: 1, padding: 0,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>?</button>
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {GAME_DESC[g]}
                          {blocked && (g === 'jopok' ? ' · 다른 게임 해제 후 선택 가능'
                            : jopokSelected ? ' · 조폭 해제 후 선택 가능'
                            : ' · 4인 이상부터 선택 가능')}
                        </p>
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
                            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 6, color: i === 0 ? '#2563eb' : '#16a34a' }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: i === 0 ? '#2563eb' : '#16a34a', flexShrink: 0 }} />
                              팀
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

                  {/* 후세인: 대결 방식 */}
                  {selGames.has(g) && g === 'hussein' && (
                    <div className="card" style={{ marginTop: 8, background: 'var(--bg)' }}>
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>대결 방식</p>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {[{ v: '134' as const, l: '연합군 전원' }, { v: '13' as const, l: '최하위 1명 제외' }].map(({ v, l }) => {
                          const disabled = v === '13' && players.length <= 3
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
                        {players.length <= 3
                          ? '후세인 점수 vs 연합군 전원 타수 합. (최하위 1명 제외는 4인 이상부터 선택할 수 있어요)'
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
                        {[{ v: 'double' as const, l: '더블50 / 트리플+100' }, { v: 'par3strict' as const, l: '파3만 한 단계 엄격' }].map(({ v, l }) => (
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
                        18홀 전체에 단독으로 적용돼요(다른 게임과 함께 불가). 기본배분은 적용, 버디값은 미적용.
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
                { key: 'nearest' as const, label: '니어리스트', cfg: nearest, setCfg: setNearest },
                { key: 'longest' as const, label: '롱기스트',   cfg: longest, setCfg: setLongest },
              ]).map(({ key, label, cfg, setCfg }) => (
                <div key={key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontWeight: 700 }}>{label} 설정</p>
                      <p style={{ fontSize: 12, color: 'var(--muted)' }}>당첨자가 설정 금액 획득 (진행자가 홀에서 선택)</p>
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

          {/* ② 홀 파 설정 */}
          {step === 'pars' && (
            <div className="card">
              <p style={{ fontWeight: 700, marginBottom: 12 }}>
                홀별 파 설정
                {holePars.every(p => p >= 3) && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
                    {' '}(총 파: {holePars.reduce((s,p) => s+p, 0)}타)
                  </span>
                )}
              </p>

              {/* 저장된 코스 원터치 칩 */}
              {combos.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {combos.map(cb => {
                    const sel = courseConfirmed
                      && cb.club === club.trim() && cb.frontCourse === frontCourse.trim() && cb.backCourse === backCourse.trim()
                    return (
                      <button key={`${cb.club}_${cb.frontCourse}_${cb.backCourse}`} onClick={() => selectCombo(cb)} style={{
                        padding: '6px 11px', borderRadius: 16, cursor: 'pointer',
                        fontSize: 12, fontWeight: 700,
                        background: sel ? 'var(--green)' : 'var(--bg)',
                        color: sel ? '#fff' : 'var(--text)',
                        border: sel ? 'none' : '1px solid var(--border)',
                      }}>
                        {cb.club} · {cb.frontCourse}/{cb.backCourse}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 골프장·전반/후반 코스 직접 입력 + 확정 */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input type="text" value={club}
                  onChange={e => { setClub(e.target.value); setCourseConfirmed(false) }}
                  placeholder="골프장 이름"
                  style={{ flex: 1.2, minWidth: 0 }} />
                <input type="text" value={frontCourse}
                  onChange={e => { setFrontCourse(e.target.value); setCourseConfirmed(false) }}
                  placeholder="전반코스"
                  style={{ flex: 1, minWidth: 0 }} />
                <input type="text" value={backCourse}
                  onChange={e => { setBackCourse(e.target.value); setCourseConfirmed(false) }}
                  placeholder="후반코스"
                  style={{ flex: 1, minWidth: 0 }} />
                <button onClick={() => applyCourse(club, frontCourse, backCourse)} style={{
                  padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                  background: courseConfirmed ? 'var(--green)' : 'var(--blue)', color: '#fff',
                }}>
                  {courseConfirmed ? '확정됨' : '확정'}
                </button>
              </div>
              {courseMsg && (
                <p style={{ fontSize: 12, color: courseMsg.includes('불러왔') ? 'var(--green)' : '#d97706', fontWeight: 600, marginBottom: 10 }}>
                  {courseMsg}
                </p>
              )}
              <div style={{ marginBottom: 20 }} />

              {[
                courseConfirmed ? `전반 (${frontCourse.trim()})` : '전반',
                courseConfirmed ? `후반 (${backCourse.trim()})` : '후반',
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
                        onChange={e => {
                          const raw = e.target.value.replace(/,/g, '').replace(/\D/g, '')
                          setVal(raw === '' ? 0 : Number(raw))
                        }}
                        onFocus={e => e.target.select()}
                        style={{ flex: 1, minWidth: 0 }} />
                      <button onClick={() => setVal(val - (g === 'scratch' || g === 'sinperio' ? bStep : 5000))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>−</button>
                      <button onClick={() => setVal(val + (g === 'scratch' || g === 'sinperio' ? bStep : 5000))} style={{ width: 34, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>+</button>
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

          {/* ④ 기본설정 (OECD + 버디설정) */}
          {step === 'extras' && (
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
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>무승부로 판돈 이월 시 다음 홀 팀 구성 (좌탄우탄·라스베가스)</p>
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

          {/* 하단 버튼: 마지막 단계 전엔 [다음], 금액설정 단계에서 [게임 시작] */}
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              {step !== 'money' ? (
                <button className="btn btn-blue"
                  disabled={(step === 'pars' && !holePars.every(p => p >= 3)) || (step === 'games' && selGames.size === 0)}
                  onClick={() => {
                    if (step === 'pars' && club.trim() && frontCourse.trim() && backCourse.trim()) {
                      // 전반/후반 코스별 홀파 프리셋 + 조합(칩) 저장 (다음 라운드부터 원터치 적용)
                      void Promise.all([
                        saveCoursePreset(club, frontCourse, holePars.slice(0, 9)),
                        saveCoursePreset(club, backCourse, holePars.slice(9)),
                        saveCourseCombo(club, frontCourse, backCourse),
                      ]).then(() => {
                        fetchCoursePresets().then(setPresets)
                        fetchCourseCombos().then(setCombos)
                      })
                    }
                    setStep(step === 'pars' ? 'extras' : step === 'extras' ? 'games' : 'money')
                  }}>
                  다음
                </button>
              ) : (
                <button className="btn btn-green" onClick={handleStart}
                  disabled={selGames.size === 0 || !holePars.every(p => p >= 3)}>
                  게임 시작 ({selGames.size}개 게임 선택됨)
                  {!holePars.every(p => p >= 3) && ' — 코스설정 필요'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
