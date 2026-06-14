'use client'
import { useEffect, useState, use, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRoom, fetchRoomFromServer, saveHoleData, setCurrentHole, finishGame, setHusseinOverride, setLasvegasTeamAOverride, setEventWinner } from '@/lib/roomStore'
import type { Room, OecdEvents, GameConfig } from '@/lib/types'
import GameSettings from '@/components/GameSettings'
import { GAME_LABELS } from '@/lib/types'
import { calcAllResults, orderedPlayerIds, resolveHussein, resolveLasvegasTeamA } from '@/lib/gameLogic'

const EMPTY_OECD: OecdEvents = { ob: 0, hazard: 0, bunker: 0, threePutt: false, tripleOrWorse: false }

function FitText({ text, color, fontWeight }: { text: string; color: string; fontWeight: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    for (let size = 13; size >= 11; size -= 0.5) {
      el.style.fontSize = size + 'px'
      if (el.scrollWidth <= el.offsetWidth) break
    }
  }, [text])
  return (
    <span ref={ref} style={{ color, fontWeight, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0, flex: 1 }}>
      {text}
    </span>
  )
}

// 티샷 순서 슬롯머신: ~3초간 숫자가 돌다가 본인 순서에 멈춤
function TeeOrderSlot({ count, final, onDone }: { count: number; final: number; onDone: () => void }) {
  const [num, setNum] = useState(1)
  const [done, setDone] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    let cancelled = false
    let cur = 0
    let delay = 60
    const start = Date.now()
    function tick() {
      if (cancelled) return
      const elapsed = Date.now() - start
      if (elapsed >= 3000) {
        setNum(final)
        setDone(true)
        onDoneRef.current()
        return
      }
      cur = cur % count + 1
      setNum(cur)
      if (elapsed > 2000) delay = Math.min(320, delay * 1.22)  // 마지막 1초 감속
      setTimeout(tick, delay)
    }
    tick()
    return () => { cancelled = true }
  }, [count, final])
  return (
    <div style={{
      margin: '0 auto', width: 130, height: 130, borderRadius: 16,
      display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2,
      background: done ? '#f0fdf4' : 'var(--bg)',
      border: done ? '2px solid var(--green)' : '2px solid var(--border)',
      transition: 'all .25s',
      paddingTop: 0, alignContent: 'center', flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: 56, fontWeight: 900, lineHeight: '126px',
        color: done ? 'var(--green)' : 'var(--muted)',
        transition: 'color .25s',
      }}>{num}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: done ? 'var(--green)' : 'var(--muted)' }}>번째</span>
    </div>
  )
}

// 실제 타수 → par 대비 상대 표시
function relStr(score: number, par: number): string {
  const d = score - par
  if (d === 0) return '0'
  return d > 0 ? `+${d}` : `${d}`
}

// 색상 (상대 점수 기준)
function scoreColor(score: number | null | undefined, par: number): string {
  if (score == null) return '#e2e8f0'
  const d = score - par
  if (d <= -2) return '#1e1b4b'  // 알바트로스·이글
  if (d <= 0)  return '#16a34a'  // 버디·파
  if (d <= 2)  return '#ca8a04'  // 보기·더블보기
  return '#dc2626'               // 트리플 이상·더블파 (빨간색)
}

// 플레이어 ID → 이름 치환
function resolveNames(detail: string, players: Room['players']): string {
  let s = detail
  for (const [id, p] of Object.entries(players)) s = s.split(id).join(p.name)
  return s
}

// 홀 적용 게임의 팀 구성 표시 (null = 결정 불가)
function getTeamDisplay(g: GameConfig, room: Room, hole: number): { text: string; unresolved: boolean; ai?: boolean } | null {
  if (g.type === 'team-match') {
    const t1 = g.teams?.team1 ?? []
    const t2 = g.teams?.team2 ?? []
    if (t1.length === 0 && t2.length === 0) return null
    const n1 = t1.map(id => room.players[id]?.name ?? '').join('+')
    const n2 = t2.map(id => room.players[id]?.name ?? '').join('+')
    return { text: `${n1} vs ${n2}`, unresolved: false }
  }
  if (g.type === 'hussein') {
    const r = resolveHussein(room, hole)
    if (r) {
      const name = room.players[r.id]?.name ?? '?'
      const allyCount = Object.keys(room.players).length - 1
      const opp = (room.config.husseinMode ?? '134') === '13' ? Math.min(2, allyCount) : allyCount
      return { text: `${name} 1:${Math.max(1, opp)}`, unresolved: false, ai: r.ai }
    }
    return { text: '미정', unresolved: true }
  }
  if (g.type === 'lasvegas') {
    const r = resolveLasvegasTeamA(room, hole)
    if (r) {
      const tB = Object.keys(room.players).filter(id => !r.teamA.includes(id))
      const a = r.teamA.map(id => room.players[id]?.name ?? '?').join('+')
      const b = tB.map(id => room.players[id]?.name ?? '?').join('+')
      return { text: `${a} vs ${b}`, unresolved: false, ai: r.ai }
    }
    return { text: '미정', unresolved: true }
  }
  if (g.type === 'jootanwootan') {
    const dirs = room.holes[hole]?.jootanwootan ?? {}
    const leftNames  = Object.entries(dirs).filter(([, d]) => d === 'left').map(([id]) => room.players[id]?.name ?? id)
    const rightNames = Object.entries(dirs).filter(([, d]) => d === 'right').map(([id]) => room.players[id]?.name ?? id)
    if (leftNames.length + rightNames.length > 0) {
      const l = leftNames.length  > 0 ? leftNames.join('+') : '없음'
      const r = rightNames.length > 0 ? rightNames.join('+') : '없음'
      return { text: `${l} vs ${r}`, unresolved: false }
    }
    return null
  }
  return null
}

const GAME_TAG_STYLE: Record<string, string> = {
  'stroke':       '#16a34a',
  'team-match':   '#2563eb',
  'jootanwootan': '#7c3aed',
  'hussein':      '#dc2626',
  'lasvegas':     '#d97706',
  'sinperio':     '#64748b',
}

// 버튼 그리드 정의 (par3: TRIPLE·QUAD 제외 / par4: QUAD 제외)
function scoreButtons(par: number) {
  const row1 = [
    { label: 'ALBATROSS', value: par - 3, color: '#1e1b4b' },
    { label: par === 3 ? 'HOLE-IN-ONE!' : 'EAGLE', value: par - 2, color: '#1e1b4b' },
    { label: 'BIRDIE',    value: par - 1, color: '#16a34a' },
    { label: 'PAR',       value: par,     color: '#16a34a' },
  ].filter(b => b.value > 0)

  const row2 = [
    { label: 'BOGEY',  value: par + 1, color: '#ca8a04' },
    { label: 'DOUBLE', value: par + 2, color: '#ca8a04' },
    ...(par >= 4 ? [{ label: 'TRIPLE', value: par + 3, color: '#dc2626' }] : []),
    ...(par >= 5 ? [{ label: 'QUAD',   value: par + 4, color: '#dc2626' }] : []),
    { label: 'DBL-PAR', value: par * 2, color: '#dc2626' },
  ]
  return { row1, row2 }
}

export default function PlayPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params)
  const router = useRouter()
  const [room, setRoom]             = useState<Room | null>(null)
  const [myId, setMyId]             = useState('')
  const [editPlayerId, setEditPlayerId] = useState('') // 진행자가 편집 중인 플레이어
  const [viewHole, setViewHole]     = useState(1)
  const [scoreInput, setScoreInput] = useState<number | ''>('')
  const [oecdInput, setOecdInput]   = useState<OecdEvents>(EMPTY_OECD)
  const [dirInput, setDirInput]     = useState<'left' | 'right' | ''>('')
  const [saving, setSaving]         = useState(false)
  const [activeTab, setActiveTab]   = useState<'score' | 'settings'>('score')
  const [showResultPopup, setShowResultPopup] = useState(false)
  const [balanceView, setBalanceView] = useState<'wallet' | 'bank'>('wallet')  // 우측 상단 금액 표시 (기본 내 보유)
  const popupShownRef = useRef(new Set<number>())
  const [pendingLvTeamA, setPendingLvTeamA] = useState<string[]>([])
  const [teeOrderSeen, setTeeOrderSeen] = useState(true)
  const [teeSlotDone, setTeeSlotDone] = useState(false)

  useEffect(() => {
    setTeeOrderSeen(sessionStorage.getItem(`golf_teeorder_seen_${roomId}`) === '1')
  }, [roomId])

  function dismissTeeOrder() {
    sessionStorage.setItem(`golf_teeorder_seen_${roomId}`, '1')
    setTeeOrderSeen(true)
  }

  useEffect(() => {
    const pid = sessionStorage.getItem('golf_player')
             ?? localStorage.getItem(`golf_player_${roomId}`)
             ?? ''
    setMyId(pid)
    setEditPlayerId(pid)
    const unsub = subscribeRoom(roomId, r => {
      setRoom(r)
      setViewHole(r.currentHole)
    })
    // 모바일 절전 복귀 시 실시간 연결이 늦게 살아나는 경우 대비, 서버에서 강제 동기화
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      fetchRoomFromServer(roomId).then(r => {
        if (r) { setRoom(r); setViewHole(r.currentHole) }
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId])

  const isHost = room?.hostPlayerId === myId
  // 진행자는 editPlayerId 플레이어를 편집, 일반 참가자는 본인
  const targetId = isHost ? (editPlayerId || myId) : myId

  // 편집 대상의 저장값 (다른 플레이어의 저장은 이 값들을 바꾸지 않음)
  const savedScore   = room?.holes[viewHole]?.scores?.[targetId]
  const savedOecdStr = JSON.stringify(room?.holes[viewHole]?.oecd?.[targetId] ?? null)
  const savedDir     = room?.holes[viewHole]?.jootanwootan?.[targetId] ?? ''

  // 홀·편집 대상이 바뀔 때만 저장값으로 입력칸 초기화
  // (방 데이터 갱신 전체에 반응하면 다른 플레이어 저장 시 내 미저장 입력이 초기화됨)
  const roomRef2 = useRef(room)
  roomRef2.current = room
  useEffect(() => {
    if (!targetId) return
    const saved = roomRef2.current?.holes[viewHole]
    setScoreInput(saved?.scores?.[targetId] ?? '')
    setOecdInput(saved?.oecd?.[targetId] ?? { ...EMPTY_OECD })
    setDirInput(saved?.jootanwootan?.[targetId] ?? '')
  }, [viewHole, targetId])

  // 내 저장값이 원격에서 실제로 바뀐 경우에만 반영 (예: 진행자가 내 점수 수정)
  useEffect(() => {
    if (savedScore != null) setScoreInput(savedScore)
  }, [savedScore])
  useEffect(() => {
    const o = JSON.parse(savedOecdStr)
    if (o) setOecdInput(o)
  }, [savedOecdStr])
  useEffect(() => {
    if (savedDir) setDirInput(savedDir)
  }, [savedDir])

  const hasJootanwootan = (hole: number) =>
    room?.config.games.some(g => g.type === 'jootanwootan' && g.holes.includes(hole)) ?? false

  const isOecdTarget = useCallback(() => {
    if (!room || !room.config.oecd.enabled) return false
    const res = calcAllResults(room)
    return res.playerTotals[targetId]?.isOecd ?? false
  }, [room, targetId])

  async function saveScore() {
    if (!room || scoreInput === '') return
    setSaving(true)
    await saveHoleData(roomId, viewHole, {
      scores: { [targetId]: Number(scoreInput) },
      oecd:   { [targetId]: oecdInput },
      jootanwootan: dirInput ? { [targetId]: dirInput } : undefined,
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

  // 참가자 팝업: 해당 홀 전원 입력 완료 시 결과 알림
  const allEnteredSafe = !!room && !!myId &&
    Object.values(room.players).every(p => (room.holes[viewHole]?.scores ?? {})[p.id] != null)

  // 니어·롱기 선택까지 끝났는지 (미설정 홀이면 true)
  const eventsDoneSafe = !!room && [
    { cfg: room.config.nearest, w: room.holes[viewHole]?.nearestWinner },
    { cfg: room.config.longest, w: room.holes[viewHole]?.longestWinner },
  ].every(e => !e.cfg?.enabled || !e.cfg.holes.includes(viewHole) || !!e.w)

  useEffect(() => {
    if (isHost || !allEnteredSafe || !eventsDoneSafe) return
    if (popupShownRef.current.has(viewHole)) return
    popupShownRef.current.add(viewHole)
    setShowResultPopup(true)
  }, [allEnteredSafe, eventsDoneSafe, viewHole, isHost])

  // 진행자가 다음 홀로 넘어가면(viewHole 변경) 참가자 결과 팝업 닫기
  useEffect(() => {
    setShowResultPopup(false)
  }, [viewHole])

  if (!room) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>로딩 중...</div>
  // 게임 종료 시 결과 화면으로 이동 (결과 화면에서 ?view=1로 돌아온 경우는 조회 허용)
  const viewOnly = typeof window !== 'undefined' && window.location.search.includes('view=1')
  if (room.status === 'finished' && !viewOnly) { router.push(`/result/${roomId}`); return null }

  const players     = Object.values(room.players)
  const holePar     = room.config.holePars[viewHole - 1] ?? 4
  const holeScores  = room.holes[viewHole]?.scores ?? {}
  const results     = calcAllResults(room)
  const allEntered  = players.every(p => holeScores[p.id] != null)
  const holeGames   = room.config.games.filter(g => g.holes.includes(viewHole))
  const holeResults = results.holeResults[viewHole] ?? []

  const myTotals       = results.playerTotals[myId]
  const myBalance      = myTotals?.wallet ?? 0

  // 총납부금 현황 (은행 잔액) = 납부 합계 − 지급된 승리금 − 기본분배 + OECD 페널티 회수
  const totalPaid    = Object.values(room.players).reduce((s, p) => s + (p.initialAmount ?? 0), 0)
  const bankBalance  = totalPaid + Object.values(results.playerTotals).reduce(
    (s, t) => s - t.walletGains - t.baseDistribution + t.oecdPenalty, 0)

  const orderedIds     = orderedPlayerIds(room)
  const orderedPlayers = orderedIds.map(id => room.players[id]).filter(Boolean)

  // ── 니어·롱기스트: 이번 홀에 활성화된 이벤트 / 미선택 이벤트 ──
  const holeEvents = ([
    { type: 'nearest' as const, label: '니어',     cfg: room.config.nearest, winner: room.holes[viewHole]?.nearestWinner },
    { type: 'longest' as const, label: '롱기스트', cfg: room.config.longest, winner: room.holes[viewHole]?.longestWinner },
  ]).filter(e => e.cfg?.enabled && e.cfg.holes.includes(viewHole))
  const pendingEvents = holeEvents.filter(e => !e.winner)

  // ── 팀 매치플레이 누적 상황 (점수 합산 자동 판정, 홀별 UP 카운트) ──
  const teamMatchCfg = room.config.games.find(g => g.type === 'team-match')
  const matchStatusByHole: Record<number, number> = {}  // 홀 → 누적 diff (블루 양수, 레드 음수)
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

  // 현재 편집 대상의 기존 점수
  const targetScore = holeScores[targetId]
  // 비진행자가 이미 입력한 경우 잠금
  const scoreLocked = !isHost && targetScore != null

  const { row1, row2 } = scoreButtons(holePar)

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
              <th style={{ padding: '7px 6px', textAlign: 'left', fontSize: 10, color: '#86efac', fontWeight: 700 }}>
                {label}
              </th>
              {holes.map(h => (
                <th key={h} onClick={() => { if (isHost || viewOnly) setViewHole(h) }} style={{
                  padding: '7px 2px', textAlign: 'center', fontSize: 12, fontWeight: 800, cursor: isHost || viewOnly ? 'pointer' : 'default',
                  color: h === viewHole ? '#fbbf24' : h === room.currentHole ? '#6ee7b7' : '#d1fae5',
                  borderBottom: h === viewHole ? '2px solid #fbbf24' : '2px solid transparent',
                }}>
                  {h}
                </th>
              ))}
              <th style={{ padding: '7px 4px', textAlign: 'center', fontSize: 10, color: '#86efac', fontWeight: 700 }}>T</th>
            </tr>
            <tr style={{ background: '#166534' }}>
              <td style={{ padding: '4px 6px', fontSize: 10, fontWeight: 700, color: '#bbf7d0' }}>PAR</td>
              {holes.map(h => (
                <td key={h} style={{
                  padding: '4px 2px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#d1fae5',
                  background: h === viewHole ? 'rgba(251,191,36,.18)' : 'transparent',
                }}>
                  {room.config.holePars[h - 1] ?? 4}
                </td>
              ))}
              <td style={{ padding: '4px 4px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#bbf7d0' }}>
                {parSum}
              </td>
            </tr>
            {/* 매치 상황 줄: 이 카드의 9개 홀이 모두 팀매치 적용 홀일 때만 표시 */}
            {teamMatchCfg && holes.every(h => teamMatchCfg.holes.includes(h)) && (
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '4px 6px', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>
                  Match
                </td>
                {holes.map(h => {
                  const d = matchStatusByHole[h]
                  return (
                    <td key={h} style={{
                      padding: '4px 1px', textAlign: 'center', fontSize: 9, fontWeight: 800,
                      color: d !== undefined ? matchCellColor(d) : 'transparent',
                      background: h === viewHole ? 'rgba(251,191,36,.12)' : 'transparent',
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
            {orderedPlayers.map((p, pi) => {
              const rowScores  = holes.map(h => room.holes[h]?.scores?.[p.id] ?? null)
              const entered    = rowScores.filter((s): s is number => s != null)
              const rowTotal   = entered.reduce((a, b) => a + b, 0)
              const isMe       = p.id === myId
              const isEditing  = isHost && p.id === editPlayerId

              return (
                <tr key={p.id} style={{
                  background: isEditing ? '#fefce8' : isMe ? '#eff6ff' : pi % 2 === 0 ? '#fff' : '#f8fafc',
                  borderTop: '1px solid #f1f5f9',
                }}>
                  <td style={{ padding: '4px 4px 4px 6px', fontSize: 11, fontWeight: isMe ? 800 : 600, color: 'var(--text)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {results.playerTotals[p.id]?.isOecd && (
                        <span style={{ fontSize: 9, color: '#dc2626', flexShrink: 0 }}>●</span>
                      )}
                    </div>
                  </td>
                  {holes.map((h, idx) => {
                    const score = rowScores[idx]
                    const par   = room.config.holePars[h - 1] ?? 4
                    const isActiveCell = h === viewHole && (isHost ? p.id === editPlayerId : isMe)
                    return (
                      <td key={h} onClick={() => {
                        if (isHost) {
                          setViewHole(h)
                          setEditPlayerId(p.id)
                        }
                      }}
                      style={{
                        padding: '7px 2px', textAlign: 'center', fontSize: 12, fontWeight: 800,
                        color: scoreColor(score, par),
                        background: isActiveCell ? 'rgba(37,99,235,.18)' : h === viewHole ? 'rgba(37,99,235,.05)' : 'transparent',
                        cursor: isHost ? 'pointer' : 'default',
                      }}>
                        {score == null ? '—'
                          : score - par <= -2 ? <span className="score-badge badge-violet">{relStr(score, par)}</span>
                          : score - par === -1 ? <span className="score-badge badge-green">{relStr(score, par)}</span>
                          : relStr(score, par)}
                      </td>
                    )
                  })}
                  <td style={{
                    padding: '7px 4px', textAlign: 'center', fontSize: 12, fontWeight: 800,
                    color: 'var(--text)', borderLeft: '1px solid #e2e8f0',
                  }}>
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
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '12px 16px 100px' }}>

      {/* 1번홀 내 티샷 순서 팝업 (슬롯머신 연출) */}
      {!teeOrderSeen && room.status === 'playing' && room.currentHole === 1
        && (room.teeOrder?.length ?? 0) > 0 && room.teeOrder!.includes(myId) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(15,23,42,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '24px 22px',
            width: '100%', maxWidth: 300, textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,.25)',
          }}>
            <p style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>1번홀 내 티샷 순서</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
              {teeSlotDone ? '순서가 정해졌습니다!' : '추첨 중...'}
            </p>
            <div style={{ marginBottom: 20 }}>
              <TeeOrderSlot
                count={room.teeOrder!.length}
                final={room.teeOrder!.indexOf(myId) + 1}
                onDone={() => setTeeSlotDone(true)}
              />
            </div>
            <button className="btn btn-green" onClick={dismissTeeOrder}
              disabled={!teeSlotDone} style={{ opacity: teeSlotDone ? 1 : .4 }}>
              확인
            </button>
          </div>
        </div>
      )}

      {/* ── 헤더 ── */}
      <div style={{ marginBottom: 14 }}>
        {/* ① 상태 · 방코드 · 금액 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {room.status === 'playing' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                fontSize: 11, fontWeight: 800, letterSpacing: '.5px',
                color: '#fff', background: '#dc2626',
                borderRadius: 4, padding: '2px 7px',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#fff',
                  animation: 'livePulse 1.2s ease-in-out infinite',
                }} />
                LIVE
              </span>
            ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                fontSize: 11, fontWeight: 800, letterSpacing: '.5px',
                color: '#fff', background: '#3b82f6',
                borderRadius: 4, padding: '2px 7px',
                animation: 'waitBlink 1.4s ease-in-out infinite',
              }}>
                WAIT
              </span>
            )}
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ color: 'var(--muted)' }}>방 코드</span>
              <span style={{ color: 'var(--green)', fontSize: 18 }}>{roomId}</span>
            </span>
          </div>
          {(() => {
            // 진행자: 내 보유 / 총납부금 탭 전환, 참가자: 내 보유만
            const showBank = isHost && balanceView === 'bank'
            const amount = showBank ? bankBalance : myBalance
            return (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {isHost ? (
                  <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', marginBottom: 3 }}>
                    {([['bank', '총납부금'], ['wallet', '내 보유']] as const).map(([v, l]) => (
                      <button key={v} onClick={() => setBalanceView(v)} style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, cursor: 'pointer',
                        border: '1px solid var(--border)', whiteSpace: 'nowrap',
                        background: balanceView === v ? 'var(--blue)' : 'var(--bg)',
                        color: balanceView === v ? '#fff' : 'var(--muted)',
                      }}>{l}</button>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 1px', whiteSpace: 'nowrap' }}>내 보유</p>
                )}
                <p style={{ fontSize: 18, fontWeight: 800, margin: 0, whiteSpace: 'nowrap', color: amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {amount.toLocaleString()}원
                </p>
                {!showBank && myTotals?.isOecd && <span className="tag-red" style={{ fontSize: 10 }}>OECD</span>}
              </div>
            )
          })()}
        </div>
        {/* ② Hole */}
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
          Hole {viewHole}
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)', marginLeft: 5 }}>(par {holePar})</span>
        </h1>
      </div>

      {/* 게임 태그 — 전체 폭 사용 */}
      {holeGames.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: -6, marginBottom: 14 }}>
            {holeGames.map(g => {
              const td = getTeamDisplay(g, room, viewHole)
              const tagBg = GAME_TAG_STYLE[g.type] ?? '#64748b'
              return (
                <div key={g.type}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, letterSpacing: '.5px',
                      padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                      background: tagBg, color: '#fff',
                      whiteSpace: 'nowrap', overflow: 'hidden',
                    }}>{GAME_LABELS[g.type]}</span>
                    {td && !td.unresolved && (
                      g.type === 'team-match' ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          minWidth: 0, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap',
                          fontSize: 13, fontWeight: 700,
                        }}>
                          <span style={{ color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(g.teams?.team1 ?? []).map(id => room.players[id]?.name ?? '').join('·')}
                          </span>
                          <span style={{ color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>vs</span>
                          <span style={{ color: '#16a34a', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(g.teams?.team2 ?? []).map(id => room.players[id]?.name ?? '').join('·')}
                          </span>
                        </span>
                      ) : (
                        <>
                          {td.ai && (
                            <span style={{ fontSize: 13, fontWeight: 800, color: '#dc2626', flexShrink: 0, whiteSpace: 'nowrap' }}>A.I 배정 </span>
                          )}
                          <FitText text={td.text} color="var(--text)" fontWeight={700} />
                        </>
                      )
                    )}
                    {td?.unresolved && (
                      <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 700, whiteSpace: 'nowrap' }}>미정</span>
                    )}
                  </div>
                  {/* 진행자 직접 선택 UI */}
                  {isHost && td?.unresolved && (
                    <div style={{ marginTop: 5, padding: '8px 10px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fca5a5' }}>
                      <p style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700, marginBottom: 6 }}>
                        {g.type === 'hussein' ? '후세인 직접 선택' : '팀A 2명 선택 (나머지 팀B)'}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {orderedPlayers.map(p => {
                          const sel = g.type === 'hussein'
                            ? room.holes[viewHole]?.husseinPlayerId === p.id
                            : pendingLvTeamA.includes(p.id)
                          return (
                            <button key={p.id} onClick={() => {
                              if (g.type === 'hussein') {
                                setHusseinOverride(roomId, viewHole, p.id)
                              } else {
                                setPendingLvTeamA(prev => {
                                  const next = prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                                  if (next.length === 2) {
                                    setLasvegasTeamAOverride(roomId, viewHole, next)
                                    return []
                                  }
                                  return next
                                })
                              }
                            }} style={{
                              padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              background: sel ? '#dc2626' : 'var(--bg)',
                              color: sel ? '#fff' : 'var(--text)',
                              border: `1px solid ${sel ? '#dc2626' : 'var(--border)'}`,
                            }}>
                              {p.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* ── 진행자 탭 ── */}
      {isHost && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {(['score', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
              fontWeight: 700, fontSize: 13,
              background: activeTab === t ? 'var(--blue)' : 'var(--card)',
              color: activeTab === t ? '#fff' : 'var(--muted)',
              border: '1px solid var(--border)',
            }}>
              {t === 'score' ? '스코어보드' : '게임설정'}
            </button>
          ))}
        </div>
      )}

      {/* ── 스코어보드 탭 ── */}
      {(activeTab === 'score' || !isHost) && (<>

        {renderScorecard('전반', 1)}
        {renderScorecard('후반', 10)}

        {/* 이번 홀 게임 결과 — 진행자 전용 */}
        {isHost && allEntered && pendingEvents.length === 0 && (holeResults.filter(r => r.game !== 'sinperio').length > 0 || (results.buddyResults[viewHole]?.length ?? 0) > 0 || (results.oecdResults[viewHole]?.length ?? 0) > 0 || (results.eventResults[viewHole]?.length ?? 0) > 0) && (
          <div style={{
            marginBottom: 14, borderRadius: 12, overflow: 'hidden',
            border: '2px solid #2563eb',
            boxShadow: '0 2px 12px rgba(37,99,235,.18)',
          }}>
            <div style={{ background: '#2563eb', padding: '9px 14px' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '.3px' }}>Hole {viewHole} 결과</span>
            </div>
            <div style={{ background: '#fff', padding: '10px 14px' }}>
              {holeResults.filter(r => r.game !== 'sinperio').map((r, i, arr) => (
                <div key={i} style={{
                  padding: '8px 0',
                  borderBottom: i < arr.length - 1 || (results.buddyResults[viewHole]?.length ?? 0) > 0 || (results.oecdResults[viewHole]?.length ?? 0) > 0 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', marginBottom: 3, letterSpacing: '.3px' }}>
                    {GAME_LABELS[r.game]}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'pre-line' }}>
                    {resolveNames(r.detail, room.players)}
                  </div>
                </div>
              ))}
              {(results.buddyResults[viewHole]?.length ?? 0) > 0 && (
                <div style={{ padding: '8px 0', borderBottom: (results.oecdResults[viewHole]?.length ?? 0) > 0 || (results.eventResults[viewHole]?.length ?? 0) > 0 ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', marginBottom: 3, letterSpacing: '.3px' }}>
                    버디값
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {results.buddyResults[viewHole].map(b =>
                      `${room.players[b.id]?.name ?? b.id} ${b.label}! (${b.count > 0 && b.amount === b.unit * b.count ? `+${b.unit.toLocaleString()}원 × ${b.count}인` : `+${b.amount.toLocaleString()}원`})`
                    ).join(' · ')}
                  </div>
                </div>
              )}
              {(results.eventResults[viewHole]?.length ?? 0) > 0 && (
                <div style={{ padding: '8px 0', borderBottom: (results.oecdResults[viewHole]?.length ?? 0) > 0 ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', marginBottom: 3, letterSpacing: '.3px' }}>
                    니어 · 롱기스트
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {results.eventResults[viewHole].map(e =>
                      e.id ? `${e.label} ${room.players[e.id]?.name ?? e.id} (+${e.amount.toLocaleString()}원)` : `${e.label} PASS`
                    ).join(' · ')}
                  </div>
                </div>
              )}
              {(results.oecdResults[viewHole]?.length ?? 0) > 0 && (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', marginBottom: 3, letterSpacing: '.3px' }}>
                    OECD 페널티
                  </div>
                  {results.oecdResults[viewHole].map((p, i) => (
                    <div key={i} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                      {room.players[p.id]?.name ?? p.id} (−{p.amount.toLocaleString()}원)
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}> ({p.detail})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 스코어 입력 ── */}
        <div className="card" style={{ marginBottom: 14, padding: '12px 14px' }}>

          {/* 진행자: 편집 대상 플레이어 선택 */}
          {isHost && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>편집 대상</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {orderedPlayers.map(p => (
                  <button key={p.id} onClick={() => setEditPlayerId(p.id)} style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: editPlayerId === p.id ? 'var(--blue)' : 'var(--bg)',
                    color: editPlayerId === p.id ? '#fff' : 'var(--muted)',
                    border: editPlayerId === p.id ? 'none' : '1px solid var(--border)',
                  }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 잠금: 비진행자가 이미 입력 완료 */}
          {scoreLocked ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <p style={{ fontSize: 28, fontWeight: 900, margin: '0 0 4px', color: scoreColor(targetScore, holePar) }}>
                {relStr(targetScore!, holePar)}
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>입력 완료</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>수정은 진행자에게 문의하세요.</p>
            </div>
          ) : (<>

            {/* 점수 버튼 Row 1 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {row1.map(btn => {
                const sel = Number(scoreInput) === btn.value
                return (
                  <button key={btn.label} onClick={() => setScoreInput(btn.value)} style={{
                    flex: 1, padding: '12px 2px', borderRadius: 7, cursor: 'pointer',
                    border: sel ? 'none' : '1px solid var(--border)',
                    background: sel ? btn.color : 'var(--bg)',
                    color: sel ? '#fff' : btn.color,
                    fontWeight: 700, fontSize: 10, lineHeight: 1.3,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span>{btn.label}</span>
                  </button>
                )
              })}
            </div>

            {/* 점수 버튼 Row 2 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {row2.map(btn => {
                const sel = Number(scoreInput) === btn.value
                return (
                  <button key={btn.label} onClick={() => setScoreInput(btn.value)} style={{
                    flex: 1, padding: '12px 2px', borderRadius: 7, cursor: 'pointer',
                    border: sel ? 'none' : '1px solid var(--border)',
                    background: sel ? btn.color : 'var(--bg)',
                    color: sel ? '#fff' : btn.color,
                    fontWeight: 700, fontSize: 10, lineHeight: 1.3,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <span>{btn.label}</span>
                  </button>
                )
              })}
            </div>

            {/* 니어·롱기스트 당첨자 선택 — 진행자 전용 */}
            {isHost && holeEvents.length > 0 && (
              <div style={{ marginBottom: 12, padding: 12, background: '#fffbeb', borderRadius: 8, border: '1px solid #fcd34d' }}>
                {holeEvents.map((ev, i) => (
                  <div key={ev.type} style={{ marginBottom: i < holeEvents.length - 1 ? 12 : 0 }}>
                    <label style={{ fontSize: 13, fontWeight: 700, color: '#d97706', display: 'block', marginBottom: 6 }}>
                      {ev.label}
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {orderedPlayers.map(p => {
                        const sel = ev.winner === p.id
                        return (
                          <button key={p.id} onClick={() => setEventWinner(roomId, viewHole, ev.type, p.id)} style={{
                            padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            background: sel ? '#d97706' : '#fff',
                            color: sel ? '#fff' : 'var(--muted)',
                            border: sel ? 'none' : '1px solid var(--border)',
                          }}>
                            {p.name}
                          </button>
                        )
                      })}
                      <button onClick={() => setEventWinner(roomId, viewHole, ev.type, 'PASS')} style={{
                        padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: ev.winner === 'PASS' ? '#64748b' : '#fff',
                        color: ev.winner === 'PASS' ? '#fff' : 'var(--muted)',
                        border: ev.winner === 'PASS' ? 'none' : '1px solid var(--border)',
                      }}>
                        PASS
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 좌탄우탄 방향 */}
            {hasJootanwootan(viewHole) && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>좌탄우탄 티샷 방향</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['left', 'right'] as const).map(d => {
                    // 한 방향 정원 = 전체 인원의 절반(올림). 본인 외 인원이 정원에 차면 마감
                    // (진행자는 수정이 필요할 수 있으므로 마감 비적용)
                    const cap = Math.ceil(Object.keys(room.players).length / 2)
                    const dirs = room.holes[viewHole]?.jootanwootan ?? {}
                    const othersInD = Object.entries(dirs).filter(([id, dir]) => id !== targetId && dir === d).length
                    const full = !isHost && othersInD >= cap && dirInput !== d
                    return (
                      <button key={d} disabled={full} onClick={() => { if (!full) setDirInput(d) }} style={{
                        flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--border)',
                        cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.4 : 1,
                        fontWeight: 700, fontSize: 15,
                        background: dirInput === d ? (d === 'left' ? 'var(--blue)' : 'var(--red)') : 'var(--bg)',
                        color: dirInput === d ? '#fff' : 'var(--muted)',
                      }}>
                        {d === 'left' ? '← 좌탄' : '우탄 →'}{full ? ' (마감)' : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* OECD 페널티 */}
            {room.config.oecd.enabled && isOecdTarget() && (
              <div style={{ marginBottom: 12, padding: 12, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 2 }}>OECD Penalty</p>
                <p style={{ fontSize: 11, color: '#b91c1c', opacity: .75, marginBottom: 8 }}>
                  트리플+ (파3는 더블+)는 자동 계산됩니다
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { key: 'ob',        label: 'OB',          isCount: true },
                    { key: 'hazard',    label: 'Hazard',      isCount: true },
                    { key: 'bunker',    label: 'Bunker',      isCount: true },
                  ].map(({ key, label }) => {
                    const val    = oecdInput[key as keyof OecdEvents] as number
                    const active = val > 0
                    const setVal = (n: number) => setOecdInput(prev => ({ ...prev, [key]: Math.max(0, n) }))
                    return (
                      <div key={key} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '4px 4px 4px 8px', borderRadius: 8, minWidth: 0,
                        background: active ? '#fee2e2' : 'var(--bg)',
                        border: `1px solid ${active ? '#fca5a5' : 'var(--border)'}`,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: active ? '#b91c1c' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                          <button onClick={() => setVal(val - 1)} disabled={val === 0} style={{
                            width: 28, height: 28, borderRadius: 6, cursor: val === 0 ? 'default' : 'pointer',
                            border: '1px solid var(--border)', background: '#fff',
                            fontSize: 15, fontWeight: 700, color: val === 0 ? '#cbd5e1' : '#b91c1c',
                          }}>−</button>
                          <span style={{
                            minWidth: 24, textAlign: 'center', fontSize: 13, fontWeight: 800,
                            color: active ? '#b91c1c' : 'var(--muted)',
                          }}>{val}</span>
                          <button onClick={() => setVal(val + 1)} style={{
                            width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
                            border: '1px solid var(--border)', background: '#fff',
                            fontSize: 15, fontWeight: 700, color: '#b91c1c',
                          }}>+</button>
                        </div>
                      </div>
                    )
                  })}
                  {(() => {
                    const active = !!oecdInput.threePutt
                    return (
                      <div onClick={() => setOecdInput(prev => ({ ...prev, threePutt: !prev.threePutt }))} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '4px 8px', borderRadius: 8, cursor: 'pointer', minWidth: 0, minHeight: 38,
                        background: active ? '#fee2e2' : 'var(--bg)',
                        border: `1px solid ${active ? '#fca5a5' : 'var(--border)'}`,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: active ? '#b91c1c' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Three Putt
                        </span>
                        {active && (
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#b91c1c', flexShrink: 0 }}>
                            ✓ 적용
                          </span>
                        )}
                      </div>
                    )
                  })()}
                </div>
                {scoreInput !== '' && (() => {
                  const s = Number(scoreInput)
                  const isAuto = holePar === 3 ? s >= holePar + 2 : s >= holePar + 3
                  return isAuto ? (
                    <p style={{ fontSize: 11, color: '#b91c1c', marginTop: 8, fontWeight: 600 }}>
                      {holePar === 3 ? '● Double Bogey+' : '● Triple Bogey+'} 페널티 자동 적용
                    </p>
                  ) : null
                })()}
              </div>
            )}

            <button className="btn" onClick={saveScore}
              disabled={scoreInput === '' || saving || (hasJootanwootan(viewHole) && !dirInput)}
              style={{ background: targetScore != null ? '#d97706' : 'var(--blue)', color: '#fff' }}>
              {saving ? '저장 중...' : targetScore != null ? '수정' : '입력'}
              {hasJootanwootan(viewHole) && !dirInput && ' (방향 선택 필요)'}
            </button>
          </>)}
        </div>

      </>)}

      {/* ── 게임설정 탭 (진행자 전용) ── */}
      {isHost && activeTab === 'settings' && (
        <GameSettings room={room} roomId={roomId} myId={myId} />
      )}

      {/* 종료 후 조회 모드: 결과 화면 복귀 */}
      {viewOnly && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <button className="btn btn-blue" onClick={() => router.push(`/result/${roomId}`)}>
              최종 정산으로 돌아가기
            </button>
          </div>
        </div>
      )}

      {/* 진행자: 다음 홀 */}
      {isHost && !viewOnly && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <button className={`btn ${viewHole === 18 ? 'btn-red' : 'btn-green'}`}
              onClick={handleNextHole} disabled={!allEntered || pendingEvents.length > 0}>
              {viewHole === 18 ? '최종 정산' : `Hole ${viewHole + 1}로 이동`}
              {!allEntered ? ` (${players.length - Object.keys(holeScores).length}명 미입력)`
                : pendingEvents.length > 0 ? ` (${pendingEvents.map(e => e.label).join('·')} 선택 필요)` : ''}
            </button>
          </div>
        </div>
      )}

      {/* 참가자 결과 팝업 (진행자가 다음 홀로 넘어가면 자동으로 닫힘) */}
      {showResultPopup && !isHost && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 360, overflow: 'hidden', border: '2px solid #dc2626' }}
          >
            <div style={{ background: '#dc2626', padding: '12px 16px' }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '.3px' }}>Hole {viewHole} 결과</span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {holeResults.filter(r => r.game !== 'sinperio').length > 0 ? (
                holeResults.filter(r => r.game !== 'sinperio').map((r, i) => (
                  <div key={i} style={{
                    padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                    background: r.winners.length > 0 ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${r.winners.length > 0 ? '#86efac' : '#e2e8f0'}`,
                  }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', marginBottom: 3 }}>
                      {GAME_LABELS[r.game]}
                    </p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-line' }}>
                      {resolveNames(r.detail, room.players)}
                    </p>
                  </div>
                ))
              ) : (results.buddyResults[viewHole]?.length ?? 0) === 0 && (results.oecdResults[viewHole]?.length ?? 0) === 0 && (results.eventResults[viewHole]?.length ?? 0) === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: '12px 0' }}>
                  이번 홀 게임 결과 없음
                </p>
              ) : null}
              {(results.eventResults[viewHole]?.length ?? 0) > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                  background: '#fffbeb', border: '1px solid #fcd34d',
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#d97706', marginBottom: 3 }}>니어 · 롱기스트</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                    {results.eventResults[viewHole].map(e =>
                      e.id ? `${e.label} ${room.players[e.id]?.name ?? e.id} (+${e.amount.toLocaleString()}원)` : `${e.label} PASS`
                    ).join(' · ')}
                  </p>
                </div>
              )}
              {(results.buddyResults[viewHole]?.length ?? 0) > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                  background: '#f0fdf4', border: '1px solid #86efac',
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', marginBottom: 3 }}>버디값</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                    {results.buddyResults[viewHole].map(b =>
                      `${room.players[b.id]?.name ?? b.id} ${b.label}! (${b.count > 0 && b.amount === b.unit * b.count ? `+${b.unit.toLocaleString()}원 × ${b.count}인` : `+${b.amount.toLocaleString()}원`})`
                    ).join(' · ')}
                  </p>
                </div>
              )}
              {(results.oecdResults[viewHole]?.length ?? 0) > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                  background: '#fef2f2', border: '1px solid #fecaca',
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', marginBottom: 3 }}>OECD 페널티</p>
                  {results.oecdResults[viewHole].map((p, i) => (
                    <p key={i} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                      {room.players[p.id]?.name ?? p.id} (−{p.amount.toLocaleString()}원)
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}> ({p.detail})</span>
                    </p>
                  ))}
                </div>
              )}
              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                진행자가 다음 홀로 넘어가면 닫힙니다
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
