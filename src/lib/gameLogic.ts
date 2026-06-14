import type {
  Room, GameConfig, GameType, HoleGameResult, PlayerTotals, Settlement, OecdEvents,
} from './types'

// ─── 유틸 ───────────────────────────────────────────────────────────────────

function rankPlayers(scores: Record<string, number>): string[][] {
  // 오름차순 정렬 → [[1등ids], [2등ids], ...]
  const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1])
  const ranks: string[][] = []
  let i = 0
  while (i < sorted.length) {
    const score = sorted[i][1]
    const group: string[] = []
    while (i < sorted.length && sorted[i][1] === score) {
      group.push(sorted[i][0])
      i++
    }
    ranks.push(group)
  }
  return ranks
}

// ─── 플레이어 표시 순서 (모든 기기 동일 보장) ───────────────────────────────

export function orderedPlayerIds(room: Room): string[] {
  const allIds = Object.keys(room.players)
  if (room.playerOrder) {
    const filtered = room.playerOrder.filter(id => room.players[id])
    if (filtered.length === allIds.length) return filtered
  }
  // 기본 순서: 진행자 먼저, 이후 참가 시각(id 타임스탬프) 순 — 클라이언트 무관 결정적
  const ts = (id: string) => Number(id.split('-')[1] ?? 0)
  return [...allIds].sort((a, b) => {
    const ha = a.startsWith('host-') ? 0 : 1
    const hb = b.startsWith('host-') ? 0 : 1
    if (ha !== hb) return ha - hb
    return ts(a) - ts(b)
  })
}

// ─── 스트로크 (개인전, 홀별 판돈 누적) ─────────────────────────────────────

function calcStroke(
  hole: number,
  scores: Record<string, number>,
  cfg: GameConfig,
  prevCarry: number,
): HoleGameResult {
  const ranks = rankPlayers(scores)
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry
  if (ranks[0].length > 1) {
    return {
      game: 'stroke', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays,
      detail: `동점 이월 (인당 ${loserPays.toLocaleString()}원 누적)`,
    }
  }
  const [winner] = ranks[0]
  return {
    game: 'stroke', winners: [winner],
    loserPays,
    carry: false, carryTotal: 0,
    detail: `${winner} 승 (+${loserPays.toLocaleString()}원)`,
  }
}

// ─── 팀 매치플레이 (팀 합산 타수 자동 판정) ──────────────────────────────────

function calcTeamMatch(
  scores: Record<string, number>,
  cfg: GameConfig,
  prevCarry: number,
  override?: [string[], string[]],   // 이월 팀 유지 시 직전 홀 팀 구성
): HoleGameResult | null {
  const team1 = override ? override[0] : (cfg.teams?.team1 ?? [])
  const team2 = override ? override[1] : (cfg.teams?.team2 ?? [])
  if (team1.length === 0 || team2.length === 0) return null
  // 양 팀 전원 점수 입력 전에는 판정 보류
  if (![...team1, ...team2].every(id => scores[id] != null)) return null
  const teams: [string[], string[]] = [team1, team2]
  const t1sum = team1.reduce((s, id) => s + scores[id], 0)
  const t2sum = team2.reduce((s, id) => s + scores[id], 0)
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry

  if (t1sum === t2sum) {
    return {
      game: 'team-match', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays, teams,
      detail: `무승부 이월 (인당 ${loserPays.toLocaleString()}원 누적)`,
    }
  }
  const winTeam  = t1sum < t2sum ? team1 : team2
  const loseTeam = t1sum < t2sum ? team2 : team1
  const winName  = t1sum < t2sum ? '블루팀' : '그린팀'
  const perWinner = Math.floor(loserPays * loseTeam.length / winTeam.length)
  return {
    game: 'team-match', winners: winTeam,
    loserPays,
    carry: false, carryTotal: 0, teams,
    detail: `${winName} 승 (1인당 +${perWinner.toLocaleString()}원)`,
  }
}

// ─── 좌탄우탄 ────────────────────────────────────────────────────────────────

function calcJootanwootan(
  scores: Record<string, number>,
  directions: Record<string, 'left' | 'right'>,
  cfg: GameConfig,
  prevCarry: number,
  override?: [string[], string[]],   // 이월 팀 유지 시 직전 홀 [좌, 우] 구성
): HoleGameResult {
  const leftIds  = override ? override[0] : Object.entries(directions).filter(([,d]) => d === 'left').map(([id]) => id)
  const rightIds = override ? override[1] : Object.entries(directions).filter(([,d]) => d === 'right').map(([id]) => id)
  const teams: [string[], string[]] = [leftIds, rightIds]
  const lsum = leftIds.reduce((s, id)  => s + (scores[id] ?? 0), 0)
  const rsum = rightIds.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry

  if (lsum === rsum) {
    return {
      game: 'jootanwootan', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays, teams,
      detail: `동점 이월 (인당 ${loserPays.toLocaleString()}원 누적)`,
    }
  }
  const winTeam  = lsum < rsum ? leftIds  : rightIds
  const loseTeam = lsum < rsum ? rightIds : leftIds
  const side = lsum < rsum ? '좌탄' : '우탄'
  const perWinner = Math.floor(loserPays * loseTeam.length / winTeam.length)
  return {
    game: 'jootanwootan', winners: winTeam,
    loserPays,
    carry: false, carryTotal: 0, teams,
    detail: `${side} 팀 승 (1인당 +${perWinner.toLocaleString()}원)`,
  }
}

// ─── 후세인 ──────────────────────────────────────────────────────────────────

// 동순위 그룹을 이전 홀들로 재귀적으로 풀어내는 함수
function resolveGroupOrder(group: string[], room: Room, fromHole: number): string[] | null {
  if (group.length <= 1) return group
  if (fromHole < 1) return null  // 모든 홀 소진 → 동순위 해소 불가
  const scores = room.holes[fromHole]?.scores
  if (!scores || group.some(id => scores[id] == null)) {
    return resolveGroupOrder(group, room, fromHole - 1)
  }
  const sorted = [...group].sort((a, b) => scores[a] - scores[b])
  const subgroups: string[][] = []
  let i = 0
  while (i < sorted.length) {
    const s = scores[sorted[i]]
    const g = [sorted[i]]; i++
    while (i < sorted.length && scores[sorted[i]] === s) { g.push(sorted[i]); i++ }
    subgroups.push(g)
  }
  const result: string[] = []
  for (const sg of subgroups) {
    if (sg.length === 1) { result.push(sg[0]); continue }
    const resolved = resolveGroupOrder(sg, room, fromHole - 1)
    if (!resolved) return null
    result.push(...resolved)
  }
  return result
}

// 완전 순위 결정 (동순위 시 이전 홀 재귀 해소, 불가 시 null)
export function findFullRanking(room: Room, currentHole: number): string[] | null {
  const playerIds = Object.keys(room.players)
  if (playerIds.length === 0) return null
  let baseHole = -1
  for (let h = currentHole - 1; h >= 1; h--) {
    const s = room.holes[h]?.scores
    if (s && playerIds.every(id => s[id] != null)) { baseHole = h; break }
  }
  if (baseHole === -1) return null
  const base = room.holes[baseHole].scores
  const sorted = [...playerIds].sort((a, b) => base[a] - base[b])
  const topGroups: string[][] = []
  let i = 0
  while (i < sorted.length) {
    const s = base[sorted[i]]
    const g = [sorted[i]]; i++
    while (i < sorted.length && base[sorted[i]] === s) { g.push(sorted[i]); i++ }
    topGroups.push(g)
  }
  const result: string[] = []
  for (const g of topGroups) {
    if (g.length === 1) { result.push(g[0]); continue }
    const resolved = resolveGroupOrder(g, room, baseHole - 1)
    if (!resolved) return null
    result.push(...resolved)
  }
  return result
}

// 하위 호환 유지 (내부 전용)
function findPrevRanking(room: Room, currentHole: number): string[] | null {
  return findFullRanking(room, currentHole)
}

// ─── 결정적(seeded) 랜덤 — 같은 홀은 항상 같은 결과 ──────────────────────────
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 후세인 결정 (진행자 지정 > 직전 순위 > A.I 랜덤). null = 미정(진행자 모드)
export function resolveHussein(room: Room, hole: number): { id: string; ai: boolean } | null {
  if (room.holes[hole]?.husseinPlayerId) return { id: room.holes[hole].husseinPlayerId!, ai: false }
  const rank = findFullRanking(room, hole)
  if (rank && rank.length >= 4) return { id: rank[1], ai: false }
  if ((room.config.teamAssign ?? 'random') === 'random') {
    const ids = Object.keys(room.players).sort()
    if (ids.length >= 4) return { id: seededShuffle(ids, hashStr(room.id + ':hs:' + hole))[0], ai: true }
  }
  return null
}

// 라스베가스 팀A 결정 (진행자 지정 > 직전 순위 1+4위 > A.I 랜덤 2:2). null = 미정
export function resolveLasvegasTeamA(room: Room, hole: number): { teamA: string[]; ai: boolean } | null {
  if (room.holes[hole]?.lasvegasTeamA) return { teamA: room.holes[hole].lasvegasTeamA!, ai: false }
  const rank = findFullRanking(room, hole)
  if (rank && rank.length >= 4) return { teamA: [rank[0], rank[3]], ai: false }
  if ((room.config.teamAssign ?? 'random') === 'random') {
    const ids = Object.keys(room.players).sort()
    if (ids.length >= 4) {
      const o = seededShuffle(ids, hashStr(room.id + ':lv:' + hole))
      return { teamA: [o[0], o[1]], ai: true }
    }
  }
  return null
}

function calcHussein(
  hole: number,
  scores: Record<string, number>,
  cfg: GameConfig,
  room: Room,
  prevCarry: number,
): HoleGameResult {
  const playerIds = Object.keys(room.players)

  const resolved = resolveHussein(room, hole)
  if (!resolved) {
    return {
      game: 'hussein', winners: [], loserPays: 0,
      carry: false, carryTotal: 0,
      detail: '후세인 미정 (진행자 지정 필요)',
    }
  }
  const husseinId = resolved.id
  const alliesIds = playerIds.filter(id => id !== husseinId)

  // 대결 방식: 134=2등 vs 1·3·4등(본인×3 vs 3명 합), 13=2등 vs 1·3등(본인×2 vs 2명 합)
  // 13 모드는 점수 비교만 1·3등으로, 금전 분배는 134와 동일(연합군 전원 지급/수령)
  const mode = room.config.husseinMode ?? '134'
  let husseinScore: number
  let alliesScore: number
  if (mode === '13') {
    // 직전 순위로 연합군 정렬 → 상위 2명(1·3등)만 점수 대결, 최하위(4등)는 점수 제외
    const rank = findFullRanking(room, hole)
    const ranked = rank ? rank.filter(id => alliesIds.includes(id)) : []
    const scoringAllies = (ranked.length === alliesIds.length ? ranked : [...alliesIds].sort()).slice(0, 2)
    husseinScore = (scores[husseinId] ?? 0) * 2
    alliesScore  = scoringAllies.reduce((s, id) => s + (scores[id] ?? 0), 0)
  } else {
    husseinScore = (scores[husseinId] ?? 0) * 3
    alliesScore  = alliesIds.reduce((s, id) => s + (scores[id] ?? 0), 0)
  }
  const perPerson = (cfg.betPerHole ?? 0) + prevCarry

  if (husseinScore === alliesScore) {
    return {
      game: 'hussein', winners: [], loserPays: 0,
      carry: true, carryTotal: perPerson,
      detail: `동점 이월 (인당 ${perPerson.toLocaleString()}원 누적)`,
    }
  }

  if (husseinScore < alliesScore) {
    // 후세인 승: 각 연합군이 perPerson씩 후세인에게 지급
    return {
      game: 'hussein', winners: [husseinId],
      loserPays: perPerson,
      carry: false, carryTotal: 0,
      detail: `후세인(${husseinId}) 독식 +${(perPerson * alliesIds.length).toLocaleString()}원`,
    }
  } else {
    // 연합군 승: 후세인이 각 연합군에게 perPerson씩 지급 → loserPays = perPerson × alliesIds.length
    return {
      game: 'hussein', winners: alliesIds,
      loserPays: perPerson * alliesIds.length,
      carry: false, carryTotal: 0,
      detail: `연합군 승 (1인당 +${perPerson.toLocaleString()}원)`,
    }
  }
}

// ─── 라스베가스 ──────────────────────────────────────────────────────────────

function calcLasvegas(
  hole: number,
  scores: Record<string, number>,
  cfg: GameConfig,
  room: Room,
  prevCarry: number,
  override?: [string[], string[]],   // 이월 팀 유지 시 직전 홀 [A, B] 구성
): HoleGameResult {
  const playerIds = Object.keys(room.players)

  let teamA: string[], teamB: string[]

  if (override) {
    teamA = override[0]
    teamB = override[1]
  } else {
    const resolved = resolveLasvegasTeamA(room, hole)
    if (!resolved) {
      return {
        game: 'lasvegas', winners: [], loserPays: 0,
        carry: false, carryTotal: 0,
        detail: '팀 미정 (진행자 지정 필요)',
      }
    }
    teamA = resolved.teamA
    teamB = playerIds.filter(id => !teamA.includes(id))
  }
  const teams: [string[], string[]] = [teamA, teamB]
  const aSum  = teamA.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const bSum  = teamB.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry

  const aNames = teamA.map(id => room.players[id]?.name ?? id).join('+')
  const bNames = teamB.map(id => room.players[id]?.name ?? id).join('+')

  if (aSum === bSum) {
    return {
      game: 'lasvegas', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays, teams,
      detail: `동점 이월 (인당 ${loserPays.toLocaleString()}원 누적)`,
    }
  }

  const winTeam  = aSum < bSum ? teamA : teamB
  const loseTeam = aSum < bSum ? teamB : teamA
  const winNames = aSum < bSum ? aNames : bNames
  const perWinner = Math.floor(loserPays * loseTeam.length / winTeam.length)

  return {
    game: 'lasvegas', winners: winTeam,
    loserPays,
    carry: false, carryTotal: 0, teams,
    detail: `${winNames} 팀 승 (1인당 +${perWinner.toLocaleString()}원)`,
  }
}

// ─── 스크레치 ────────────────────────────────────────────────────────────────

function calcScratch(
  scores: Record<string, number>,
  cfg: GameConfig,
): Record<string, number> {
  const bet = cfg.betPerStroke ?? 0
  const deltas: Record<string, number> = {}
  const ids = Object.keys(scores)
  for (const id of ids) deltas[id] = 0

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j]
      const diff = (scores[b] - scores[a]) * bet  // 양수면 a가 유리
      deltas[a] += diff
      deltas[b] -= diff
    }
  }
  return deltas
}

// ─── 신페리오 핸디캡 ─────────────────────────────────────────────────────────

export function selectSinperioHoles(holePars: number[]): number[] {
  // 홀 번호 1~18 중에서 파3×2, 파4×2, 파5×2 무작위 선택 (마지막 2홀 제외: 8,9,17,18)
  const excluded = new Set([8, 9, 17, 18])
  const par3: number[] = [], par4: number[] = [], par5: number[] = []
  for (let h = 1; h <= 18; h++) {
    if (excluded.has(h)) continue
    const p = holePars[h - 1]
    if (p === 3) par3.push(h)
    else if (p === 4) par4.push(h)
    else if (p === 5) par5.push(h)
  }
  const pick = (arr: number[], n: number) => {
    const shuffled = [...arr].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, n)
  }
  return [
    ...pick(par3, Math.min(2, par3.length)),
    ...pick(par4, Math.min(2, par4.length)),
    ...pick(par5, Math.min(2, par5.length)),
  ]
}

function calcSinperio(
  room: Room,
  cfg: GameConfig,
): {
  deltas: Record<string, number>
  netScores: Record<string, number>
  grossScores: Record<string, number>
  handicaps: Record<string, number>
  transfers: Settlement[]
} {
  const { holePars } = room.config
  const selectedHoles = room.sinperioHoles
  const playerIds = Object.keys(room.players)
  const totalPar = holePars.reduce((s, p) => s + p, 0)
  const bet = cfg.totalBet ?? 0  // 타당 금액
  const netScores: Record<string, number> = {}
  const grossScores: Record<string, number> = {}
  const handicaps: Record<string, number> = {}

  for (const pid of playerIds) {
    let gross = 0
    for (let h = 1; h <= 18; h++) {
      gross += room.holes[h]?.scores?.[pid] ?? holePars[h - 1]
    }

    let selected6sum = 0
    for (const h of selectedHoles) {
      const par    = holePars[h - 1]
      const raw    = room.holes[h]?.scores?.[pid] ?? par
      const capped = Math.min(raw, par + 2)  // 더블파+1 상한
      selected6sum += capped
    }

    const handicap = Math.round((selected6sum * 3 - totalPar) * 0.8)
    grossScores[pid] = gross
    handicaps[pid]   = handicap
    netScores[pid]   = gross - handicap
  }

  // 플레이어 쌍별 넷스코어 타수 차이 × 타당 금액 → 순손익 합산
  const deltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const a = playerIds[i], b = playerIds[j]
      const diff = (netScores[b] - netScores[a]) * bet  // 양수면 a 승
      deltas[a] += diff
      deltas[b] -= diff
    }
  }

  // 순손익 기준 최소 이체 (중간 경유 없이 직접 지급)
  const name = (id: string) => room.players[id]?.name ?? id
  const debtors   = playerIds.filter(id => deltas[id] < 0).map(id => ({ id, amt: -deltas[id] })).sort((a, b) => b.amt - a.amt)
  const creditors = playerIds.filter(id => deltas[id] > 0).map(id => ({ id, amt:  deltas[id] })).sort((a, b) => b.amt - a.amt)
  const transfers: Settlement[] = []
  let di = 0, ci = 0
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amt, creditors[ci].amt)
    transfers.push({ from: name(debtors[di].id), to: name(creditors[ci].id), amount: pay })
    debtors[di].amt   -= pay
    creditors[ci].amt -= pay
    if (debtors[di].amt === 0) di++
    if (creditors[ci].amt === 0) ci++
  }

  return { deltas, netScores, grossScores, handicaps, transfers }
}

// ─── 홀별 팀 구성 (버디값 같은 팀 제외용) ────────────────────────────────────

function getHoleTeams(room: Room, hole: number): string[][] {
  const playerIds = Object.keys(room.players)
  const holeData = room.holes[hole]
  const teams: string[][] = []
  for (const cfg of room.config.games) {
    if (!cfg.holes.includes(hole)) continue
    if (cfg.type === 'team-match' && cfg.teams) {
      teams.push(cfg.teams.team1 ?? [], cfg.teams.team2 ?? [])
    } else if (cfg.type === 'jootanwootan') {
      const dirs = holeData?.jootanwootan ?? {}
      teams.push(
        Object.entries(dirs).filter(([, d]) => d === 'left').map(([id]) => id),
        Object.entries(dirs).filter(([, d]) => d === 'right').map(([id]) => id),
      )
    } else if (cfg.type === 'lasvegas') {
      let teamA: string[] | null = holeData?.lasvegasTeamA ?? null
      if (!teamA) {
        const rank = findFullRanking(room, hole)
        if (rank && rank.length >= 4) teamA = [rank[0], rank[3]]
      }
      if (teamA) {
        const a = teamA
        teams.push(a, playerIds.filter(id => !a.includes(id)))
      }
    }
  }
  return teams
}

// ─── OECD 페널티 계산 ────────────────────────────────────────────────────────

function calcOecdPenalty(
  playerId: string,
  events: OecdEvents,
  holePar: number,
  playerScore: number,
  oecdCfg: Room['config']['oecd'],
): { amount: number; detail: string } {
  if (!oecdCfg.enabled) return { amount: 0, detail: '' }
  let count = 0
  const parts: string[] = []
  if (events.ob > 0)     { count += events.ob;     parts.push(events.ob > 1 ? `OB ×${events.ob}` : 'OB') }
  if (events.hazard > 0) { count += events.hazard; parts.push(events.hazard > 1 ? `Hazard ×${events.hazard}` : 'Hazard') }
  if (events.bunker > 0) { count += events.bunker; parts.push(events.bunker > 1 ? `Bunker ×${events.bunker}` : 'Bunker') }
  if (events.threePutt)  { count += 1; parts.push('Three Putt') }
  const isTripleOrWorse = holePar === 3
    ? playerScore >= holePar + 2   // 파3: 더블이상
    : playerScore >= holePar + 3   // 일반: 트리플이상
  if (isTripleOrWorse || events.tripleOrWorse) {
    count += 1
    parts.push(holePar === 3 ? 'Double Bogey+' : 'Triple Bogey+')
  }
  const raw = count * oecdCfg.penaltyPerEvent
  const amount = Math.min(raw, oecdCfg.maxPerHole)
  if (amount < raw) parts.push('상한 적용')
  return { amount, detail: parts.join(' · ') }
}

// ─── 전체 정산 계산 (메인) ────────────────────────────────────────────────────

export function calcAllResults(room: Room): {
  holeResults: Record<number, HoleGameResult[]>
  playerTotals: Record<string, PlayerTotals>
  sinperioDeltas: Record<string, number>
  sinperioNetScores: Record<string, number>
  sinperioGross: Record<string, number>
  sinperioHandicaps: Record<string, number>
  sinperioTransfers: Settlement[]
  buddyResults: Record<number, { id: string; amount: number; label: string; unit: number; count: number }[]>
  oecdResults: Record<number, { id: string; amount: number; detail: string }[]>
  eventResults: Record<number, { label: string; id: string | null; amount: number }[]>
  settlements: Settlement[]
} {
  const playerIds = Object.keys(room.players)
  const gameDeltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const walletGains: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const buddyDeltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const oecdPenalties: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const holeResults: Record<number, HoleGameResult[]> = {}
  const buddyResults: Record<number, { id: string; amount: number; label: string; unit: number; count: number }[]> = {}
  const oecdResults: Record<number, { id: string; amount: number; detail: string }[]> = {}
  const eventResults: Record<number, { label: string; id: string | null; amount: number }[]> = {}
  let sinperioDeltas: Record<string, number> = {}
  const oecdMembers = new Set<string>()
  const buddyCfg = room.config.buddy
  const baseDistribution = buddyCfg?.baseDistribution ?? 0  // 버디 활성화와 무관하게 적용

  // 이월 추적 (총 상금 누적). 전달 규칙:
  //  - 같은 게임 연속: 누적
  //  - 단체전 → 개인전(스트로크): 팀 상금 전체를 개인 승자에게 몰빵
  //  - 그 외(개인→단체, 다른 단체전 진입): 전달 안 됨, 은행에 남김(소멸)
  let carry = 0
  let carryType: GameType | null = null               // 이월 발생 게임 종류
  let carryTeams: [string[], string[]] | null = null  // 직전 무승부 팀 구성 (팀 유지용)
  const teamKeep = room.config.teamCarryKeep ?? true

  for (let h = 1; h <= 18; h++) {
    const holeData = room.holes[h]
    if (!holeData) continue
    const holePar  = room.config.holePars[h - 1] ?? 4
    const scores   = holeData.scores ?? {}
    const results: HoleGameResult[] = []

    for (const cfg of room.config.games) {
      if (!cfg.holes.includes(h)) continue
      if (cfg.type === 'scratch' || cfg.type === 'sinperio') continue  // 이월 비대상 (별도 처리)

      // 이월 전달 규칙: 같은 게임이거나 개인전(스트로크)이 받을 때만 전달, 그 외엔 은행에 남김
      const carryApplies = carry > 0 && (cfg.type === carryType || cfg.type === 'stroke')
      if (carry > 0 && !carryApplies) {
        // 다른 종류의 게임(특히 단체전)으로 진입 → 이월금 은행에 남기고 소멸
        carry = 0; carryType = null; carryTeams = null
      }

      // 팀 유지: 직전 무승부가 같은 팀게임(좌탄우탄·라스베가스)이면 직전 팀 구성 재사용
      const override = (teamKeep && carryApplies && carryTeams && carryType === cfg.type
        && (cfg.type === 'jootanwootan' || cfg.type === 'lasvegas'))
        ? carryTeams : undefined
      let result: HoleGameResult | null = null

      // 홀 자체 판돈만 계산 (이월금은 별도 적립·지급)
      if (cfg.type === 'stroke') {
        result = calcStroke(h, scores, cfg, 0)
      } else if (cfg.type === 'team-match') {
        result = calcTeamMatch(scores, cfg, 0, override)
      } else if (cfg.type === 'jootanwootan') {
        result = calcJootanwootan(scores, holeData.jootanwootan ?? {}, cfg, 0, override)
      } else if (cfg.type === 'hussein') {
        result = calcHussein(h, scores, cfg, room, 0)
      } else if (cfg.type === 'lasvegas') {
        result = calcLasvegas(h, scores, cfg, room, 0, override)
      }

      if (result) {
        // 이번 홀에 걸린 총 상금 풀 (승리 측이 가져갈 금액)
        const poolOf = (r: HoleGameResult): number => {
          if (r.teams) {
            const [a, b] = r.teams
            return r.carryTotal * Math.max(1, Math.round((a.length + b.length) / 2))
          }
          if (cfg.type === 'hussein') return r.carryTotal * Math.max(1, playerIds.length - 1)
          return r.carryTotal  // 스트로크: 승자 상금 = 설정금액
        }

        if (result.carry) {
          // 무승부 → 이번 홀 상금 풀을 이월에 누적 (carryApplies면 기존 이월 유지)
          carry = (carryApplies ? carry : 0) + poolOf(result)
          carryType = cfg.type
          carryTeams = result.teams ?? null
          result.detail = `이월 (누적 ${carry.toLocaleString()}원)`
        } else {
          // 승자 결정 → 적립 이월금 지급 (전달 조건 충족 시) 후 이번 홀 자체 정산
          if (carryApplies && carry > 0 && result.winners.length > 0) {
            const share = carry / result.winners.length
            for (const wid of result.winners) {
              gameDeltas[wid] += share
              walletGains[wid] += share
            }
            result.detail += ` · 이월 (+${carry.toLocaleString()}원)`
          }
          carry = 0; carryType = null; carryTeams = null

          const losers = playerIds.filter(id => !result!.winners.includes(id))
          for (const wid of result.winners) {
            // 스트로크: 승자는 홀당 설정금액만 수령. 그 외 게임: 패자 수 비례 수령
            const gain = cfg.type === 'stroke'
              ? result.loserPays / result.winners.length
              : result.loserPays * losers.length / result.winners.length
            gameDeltas[wid] += gain
            walletGains[wid] += gain  // 승리금은 은행에서 지갑으로
          }
          for (const lid of losers) {
            gameDeltas[lid] -= result.loserPays  // 패배금은 은행 부담 (지갑 불변)
          }
        }
        results.push(result)
      }
    }

    // 스크레치 (홀별 누적)
    const scratchCfg = room.config.games.find(g => g.type === 'scratch' && g.holes.includes(h))
    if (scratchCfg && Object.keys(scores).length > 0) {
      const deltas = calcScratch(scores, scratchCfg)
      for (const [id, d] of Object.entries(deltas)) {
        gameDeltas[id] = (gameDeltas[id] ?? 0) + d
        walletGains[id] = (walletGains[id] ?? 0) + d  // 스크레치는 지갑↔지갑 (손익 모두 반영)
      }
      // 순이익 기준 최소 이체로 정리 (중간 경유 없이 직접 지급)
      const ids = Object.keys(scores)
      const pname = (id: string) => room.players[id]?.name ?? id
      const debtors   = ids.filter(id => deltas[id] < 0).map(id => ({ id, amt: -deltas[id] })).sort((a, b) => b.amt - a.amt)
      const creditors = ids.filter(id => deltas[id] > 0).map(id => ({ id, amt:  deltas[id] })).sort((a, b) => b.amt - a.amt)
      const transfers: string[] = []
      let di = 0, ci = 0
      while (di < debtors.length && ci < creditors.length) {
        const pay = Math.min(debtors[di].amt, creditors[ci].amt)
        transfers.push(`${pname(debtors[di].id)} → ${pname(creditors[ci].id)} ${pay.toLocaleString()}원`)
        debtors[di].amt   -= pay
        creditors[ci].amt -= pay
        if (debtors[di].amt === 0) di++
        if (creditors[ci].amt === 0) ci++
      }
      results.push({
        game: 'scratch', winners: [], loserPays: 0,
        carry: false, carryTotal: 0,
        detail: transfers.length > 0 ? transfers.join('\n') : '전원 동타 (정산 없음)',
      })
    }

    // 버디값 계산 (지갑↔지갑, 같은 팀 제외 옵션)
    if (buddyCfg?.enabled && (buddyCfg.buddyValue ?? 0) > 0) {
      const bVal = buddyCfg.buddyValue
      const makers = playerIds.filter(id => {
        const s = scores[id]
        return s != null && s <= holePar - 1
      })
      if (makers.length > 0) {
        const fromTeammates = buddyCfg.collectFromTeammates ?? false
        const holeTeams = fromTeammates ? [] : getHoleTeams(room, h)
        const isTeammate = (a: string, b: string) =>
          holeTeams.some(t => t.includes(a) && t.includes(b))
        // 현재 지갑 잔액 (지갑은 마이너스 불가 — 잔액 한도 내에서만 지급)
        const walletOf = (pid: string) =>
          baseDistribution + walletGains[pid] + buddyDeltas[pid] - oecdPenalties[pid]
        const holeGains: Record<string, number> = {}
        const holeCount: Record<string, number> = {}  // 각 버디 메이커가 받은 인원 수
        for (const maker of makers) { holeGains[maker] = 0; holeCount[maker] = 0 }
        for (const pid of playerIds) {
          if (makers.includes(pid)) continue  // 버디한 사람끼리는 주고받지 않음
          for (const maker of makers) {
            if (!fromTeammates && isTeammate(maker, pid)) continue  // 같은 팀 제외
            const pay = Math.min(bVal, Math.max(0, walletOf(pid)))  // 잔액 부족 시 있는 만큼만
            if (pay <= 0) continue
            buddyDeltas[pid]   -= pay
            buddyDeltas[maker] += pay
            holeGains[maker]   += pay
            holeCount[maker]   += 1
          }
        }
        buddyResults[h] = makers.map(m => {
          const d = (scores[m] ?? holePar) - holePar
          const label = d <= -3 ? '알바트로스' : d === -2 ? '이글' : '버디'
          return { id: m, amount: holeGains[m] ?? 0, label, unit: bVal, count: holeCount[m] ?? 0 }
        })
      }
    }

    // 니어·롱기스트 (당첨금은 은행→지갑, PASS는 정산 없음)
    const eventDefs = [
      { cfg: room.config.nearest, winner: holeData.nearestWinner, label: '니어' },
      { cfg: room.config.longest, winner: holeData.longestWinner, label: '롱기스트' },
    ]
    for (const { cfg: evCfg, winner, label } of eventDefs) {
      if (!evCfg?.enabled || !evCfg.holes.includes(h) || !winner) continue
      if (winner !== 'PASS' && playerIds.includes(winner)) {
        walletGains[winner] += evCfg.amount
        gameDeltas[winner]  += evCfg.amount
        ;(eventResults[h] ??= []).push({ label, id: winner, amount: evCfg.amount })
      } else {
        ;(eventResults[h] ??= []).push({ label, id: null, amount: 0 })
      }
    }

    // OECD 페널티
    const oecdCfg = room.config.oecd
    if (oecdCfg.enabled) {
      // 1) 임계값 도달 시 가입 (내 보유액 = 기본분배 + 승리금 + 버디 손익 − 페널티)
      for (const pid of playerIds) {
        const running = baseDistribution + walletGains[pid] + buddyDeltas[pid] - oecdPenalties[pid]
        if (running >= oecdCfg.threshold && running > 0) oecdMembers.add(pid)
      }
      // 2) 자동 가입: 전체 인원 중 1명만 남았으면 그 1명도 자동 가입
      if (playerIds.length > 1 && oecdMembers.size >= playerIds.length - 1) {
        for (const pid of playerIds) oecdMembers.add(pid)
      }
      // 3) 페널티 적용 (OECD 회원 + 수익 > 0). 18홀 해제 옵션 시 마지막 홀은 페널티 없음
      const lastHoleReleased = h === 18 && (oecdCfg.lastHoleRelease ?? true)
      for (const pid of playerIds) {
        if (lastHoleReleased) break
        if (!oecdMembers.has(pid)) continue
        const events = holeData.oecd?.[pid]
        const running = baseDistribution + walletGains[pid] + buddyDeltas[pid] - oecdPenalties[pid]
        if (running > 0 && events) {
          const { amount, detail } = calcOecdPenalty(pid, events, holePar, scores[pid] ?? holePar, oecdCfg)
          oecdPenalties[pid] += amount
          if (amount > 0) {
            (oecdResults[h] ??= []).push({ id: pid, amount, detail })
          }
        }
      }
    }

    holeResults[h] = results
  }

  // 신페리오 (라운드 완료 시) — 지갑·정산과 분리, 플레이어간 별도 정산
  let sinperioNetScores: Record<string, number> = {}
  let sinperioGross: Record<string, number> = {}
  let sinperioHandicaps: Record<string, number> = {}
  let sinperioTransfers: Settlement[] = []
  const sinperioCfg = room.config.games.find(g => g.type === 'sinperio')
  const allScoresFilled = Array.from({ length: 18 }, (_, i) => i + 1).every(
    h => room.holes[h]?.scores && playerIds.every(id => room.holes[h].scores[id] != null)
  )
  if (sinperioCfg && allScoresFilled && room.sinperioHoles.length > 0) {
    const sp = calcSinperio(room, sinperioCfg)
    sinperioDeltas = sp.deltas
    sinperioNetScores = sp.netScores
    sinperioGross = sp.grossScores
    sinperioHandicaps = sp.handicaps
    sinperioTransfers = sp.transfers
  }

  // 플레이어 최종 손익
  const playerTotals: Record<string, PlayerTotals> = {}
  for (const pid of playerIds) {
    const gameDelta  = gameDeltas[pid] ?? 0
    const gains      = walletGains[pid] ?? 0
    const buddyDelta = buddyDeltas[pid] ?? 0
    const rawPenalty = oecdPenalties[pid] ?? 0
    // 페널티는 지갑 잔액(페널티 차감 전)을 초과할 수 없음
    const walletBefore = baseDistribution + gains + buddyDelta
    const penalty    = Math.min(rawPenalty, Math.max(0, walletBefore))
    const wallet     = walletBefore - penalty
    const net        = baseDistribution + gameDelta + buddyDelta - penalty
    const isOecd     = oecdMembers.has(pid)
    playerTotals[pid] = {
      gameAmount: gameDelta,
      walletGains: gains,
      buddyNet: buddyDelta,
      baseDistribution,
      oecdPenalty: penalty,
      wallet,
      net,
      isOecd,
    }
  }

  // 최소 이체 정산
  const settlements = minimizeSettlements(playerTotals, room.players)

  return { holeResults, playerTotals, sinperioDeltas, sinperioNetScores, sinperioGross, sinperioHandicaps, sinperioTransfers, buddyResults, oecdResults, eventResults, settlements }
}

// ─── 최소 이체 정산 알고리즘 ─────────────────────────────────────────────────

function minimizeSettlements(
  totals: Record<string, PlayerTotals>,
  players: Room['players'],
): Settlement[] {
  const balances: { id: string; name: string; amount: number }[] = Object.entries(totals).map(
    ([id, t]) => ({ id, name: players[id]?.name ?? id, amount: t.net })
  )

  const settlements: Settlement[] = []
  const debtors   = balances.filter(b => b.amount < 0).sort((a, b) => a.amount - b.amount)
  const creditors = balances.filter(b => b.amount > 0).sort((a, b) => b.amount - a.amount)

  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const debt   = -debtors[i].amount
    const credit = creditors[j].amount
    const amount = Math.min(debt, credit)
    settlements.push({ from: debtors[i].name, to: creditors[j].name, amount })
    debtors[i].amount += amount
    creditors[j].amount -= amount
    if (debtors[i].amount === 0) i++
    if (creditors[j].amount === 0) j++
  }
  return settlements
}
