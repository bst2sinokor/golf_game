import type {
  Room, GameConfig, HoleGameResult, PlayerTotals, Settlement, OecdEvents,
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

// ─── 팀 매치플레이 (진행자가 입력한 홀 결과 기준) ───────────────────────────

function calcTeamMatch(
  result: 'blue' | 'red' | 'tie' | undefined,
  cfg: GameConfig,
  prevCarry: number,
): HoleGameResult | null {
  if (!result) return null  // 진행자 미입력
  const team1 = cfg.teams?.team1 ?? []
  const team2 = cfg.teams?.team2 ?? []
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry

  if (result === 'tie') {
    return {
      game: 'team-match', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays,
      detail: `무승부 이월 (인당 ${loserPays.toLocaleString()}원 누적)`,
    }
  }
  const winTeam  = result === 'blue' ? team1 : team2
  const loseTeam = result === 'blue' ? team2 : team1
  const winName  = result === 'blue' ? '블루팀' : '레드팀'
  const perWinner = Math.floor(loserPays * loseTeam.length / winTeam.length)
  return {
    game: 'team-match', winners: winTeam,
    loserPays,
    carry: false, carryTotal: 0,
    detail: `${winName} 승 (1인당 +${perWinner.toLocaleString()}원)`,
  }
}

// ─── 좌탄우탄 ────────────────────────────────────────────────────────────────

function calcJootanwootan(
  scores: Record<string, number>,
  directions: Record<string, 'left' | 'right'>,
  cfg: GameConfig,
  prevCarry: number,
): HoleGameResult {
  const leftIds  = Object.entries(directions).filter(([,d]) => d === 'left').map(([id]) => id)
  const rightIds = Object.entries(directions).filter(([,d]) => d === 'right').map(([id]) => id)
  const lsum = leftIds.reduce((s, id)  => s + (scores[id] ?? 0), 0)
  const rsum = rightIds.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry

  if (lsum === rsum) {
    return {
      game: 'jootanwootan', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays,
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
    carry: false, carryTotal: 0,
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

function calcHussein(
  hole: number,
  scores: Record<string, number>,
  cfg: GameConfig,
  room: Room,
  prevCarry: number,
): HoleGameResult {
  const playerIds = Object.keys(room.players)

  let husseinId: string | undefined
  let alliesIds: string[]

  if (room.holes[hole]?.husseinPlayerId) {
    husseinId = room.holes[hole].husseinPlayerId!
    alliesIds = playerIds.filter(id => id !== husseinId)
  } else {
    const rank = findFullRanking(room, hole)
    if (!rank || rank.length < 4) {
      return {
        game: 'hussein', winners: [], loserPays: 0,
        carry: false, carryTotal: 0,
        detail: '후세인 미정 (진행자 지정 필요)',
      }
    }
    husseinId = rank[1]
    alliesIds = [rank[0], rank[2], rank[3]]
  }

  const husseinScore = (scores[husseinId] ?? 0) * 3
  const alliesScore  = alliesIds.reduce((s, id) => s + (scores[id] ?? 0), 0)
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
): HoleGameResult {
  const playerIds = Object.keys(room.players)

  let teamA: string[], teamB: string[]

  if (room.holes[hole]?.lasvegasTeamA) {
    teamA = room.holes[hole].lasvegasTeamA!
    teamB = playerIds.filter(id => !teamA.includes(id))
  } else {
    const rank = findFullRanking(room, hole)
    if (!rank || rank.length < 4) {
      return {
        game: 'lasvegas', winners: [], loserPays: 0,
        carry: false, carryTotal: 0,
        detail: '팀 미정 (진행자 지정 필요)',
      }
    }
    // 1위+4위 vs 2위+3위
    teamA = [rank[0], rank[3]]
    teamB = [rank[1], rank[2]]
  }
  const aSum  = teamA.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const bSum  = teamB.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const loserPays = (cfg.betPerHole ?? 0) + prevCarry

  const aNames = teamA.map(id => room.players[id]?.name ?? id).join('+')
  const bNames = teamB.map(id => room.players[id]?.name ?? id).join('+')

  if (aSum === bSum) {
    return {
      game: 'lasvegas', winners: [], loserPays: 0,
      carry: true, carryTotal: loserPays,
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
    carry: false, carryTotal: 0,
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
): { deltas: Record<string, number>; netScores: Record<string, number>; transfers: Settlement[] } {
  const { holePars } = room.config
  const selectedHoles = room.sinperioHoles
  const playerIds = Object.keys(room.players)
  const totalPar = holePars.reduce((s, p) => s + p, 0)
  const bet = cfg.totalBet ?? 0  // 타당 금액
  const netScores: Record<string, number> = {}

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
    netScores[pid] = gross - handicap
  }

  // 플레이어 쌍별 넷스코어 타수 차이 × 타당 금액 정산
  const deltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const transfers: Settlement[] = []
  const name = (id: string) => room.players[id]?.name ?? id

  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const a = playerIds[i], b = playerIds[j]
      const diff = (netScores[b] - netScores[a]) * bet  // 양수면 a 승
      deltas[a] += diff
      deltas[b] -= diff
      if (diff > 0)      transfers.push({ from: name(b), to: name(a), amount: diff })
      else if (diff < 0) transfers.push({ from: name(a), to: name(b), amount: -diff })
    }
  }
  return { deltas, netScores, transfers }
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
): number {
  if (!oecdCfg.enabled) return 0
  let count = 0
  count += events.ob
  count += events.hazard
  count += events.bunker
  if (events.threePutt) count += 1
  const isTripleOrWorse = holePar === 3
    ? playerScore >= holePar + 2   // 파3: 더블이상
    : playerScore >= holePar + 3   // 일반: 트리플이상
  if (isTripleOrWorse || events.tripleOrWorse) count += 1
  const raw = count * oecdCfg.penaltyPerEvent
  return Math.min(raw, oecdCfg.maxPerHole)
}

// ─── 전체 정산 계산 (메인) ────────────────────────────────────────────────────

export function calcAllResults(room: Room): {
  holeResults: Record<number, HoleGameResult[]>
  playerTotals: Record<string, PlayerTotals>
  sinperioDeltas: Record<string, number>
  sinperioNetScores: Record<string, number>
  sinperioTransfers: Settlement[]
  buddyResults: Record<number, { id: string; amount: number }[]>
  oecdResults: Record<number, { id: string; amount: number }[]>
  settlements: Settlement[]
} {
  const playerIds = Object.keys(room.players)
  const gameDeltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const walletGains: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const buddyDeltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const oecdPenalties: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const holeResults: Record<number, HoleGameResult[]> = {}
  const buddyResults: Record<number, { id: string; amount: number }[]> = {}
  const oecdResults: Record<number, { id: string; amount: number }[]> = {}
  let sinperioDeltas: Record<string, number> = {}
  const oecdMembers = new Set<string>()
  const buddyCfg = room.config.buddy
  const baseDistribution = (buddyCfg?.enabled ? (buddyCfg.baseDistribution ?? 0) : 0)

  // 게임별 이월 추적
  const carryMap: Record<string, number> = {}
  for (const cfg of room.config.games) {
    carryMap[cfg.type] = 0
  }

  for (let h = 1; h <= 18; h++) {
    const holeData = room.holes[h]
    if (!holeData) continue
    const holePar  = room.config.holePars[h - 1] ?? 4
    const scores   = holeData.scores ?? {}
    const results: HoleGameResult[] = []

    for (const cfg of room.config.games) {
      if (!cfg.holes.includes(h)) continue
      const prevCarry = carryMap[cfg.type] ?? 0
      let result: HoleGameResult | null = null

      if (cfg.type === 'stroke') {
        result = calcStroke(h, scores, cfg, prevCarry)
      } else if (cfg.type === 'team-match') {
        result = calcTeamMatch(holeData.teamMatch, cfg, prevCarry)
      } else if (cfg.type === 'jootanwootan') {
        result = calcJootanwootan(scores, holeData.jootanwootan ?? {}, cfg, prevCarry)
      } else if (cfg.type === 'hussein') {
        result = calcHussein(h, scores, cfg, room, prevCarry)
      } else if (cfg.type === 'lasvegas') {
        result = calcLasvegas(h, scores, cfg, room, prevCarry)
      }

      if (result) {
        if (result.carry) {
          carryMap[cfg.type] = result.carryTotal
        } else {
          carryMap[cfg.type] = 0
          const losers = playerIds.filter(id => !result!.winners.includes(id))
          for (const wid of result.winners) {
            // 스트로크: 승자는 홀당 설정금액(+이월)만 수령. 그 외 게임: 패자 수 비례 수령
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
      results.push({
        game: 'scratch', winners: [], loserPays: 0,
        carry: false, carryTotal: 0,
        detail: '스크레치 홀별 정산',
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
        const holeGains: Record<string, number> = {}
        for (const maker of makers) {
          holeGains[maker] = 0
          for (const pid of playerIds) {
            if (makers.includes(pid)) continue  // 버디한 사람끼리는 주고받지 않음
            if (!fromTeammates && isTeammate(maker, pid)) continue  // 같은 팀 제외
            buddyDeltas[maker] += bVal
            buddyDeltas[pid]   -= bVal
            holeGains[maker]   += bVal
          }
        }
        buddyResults[h] = makers.map(m => ({ id: m, amount: holeGains[m] ?? 0 }))
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
      // 3) 페널티 적용 (OECD 회원 + 수익 > 0)
      for (const pid of playerIds) {
        if (!oecdMembers.has(pid)) continue
        const events = holeData.oecd?.[pid]
        const running = baseDistribution + walletGains[pid] + buddyDeltas[pid] - oecdPenalties[pid]
        if (running > 0 && events) {
          const penalty = calcOecdPenalty(pid, events, holePar, scores[pid] ?? holePar, oecdCfg)
          oecdPenalties[pid] += penalty
          if (penalty > 0) {
            (oecdResults[h] ??= []).push({ id: pid, amount: penalty })
          }
        }
      }
    }

    holeResults[h] = results
  }

  // 신페리오 (라운드 완료 시) — 지갑·정산과 분리, 플레이어간 별도 정산
  let sinperioNetScores: Record<string, number> = {}
  let sinperioTransfers: Settlement[] = []
  const sinperioCfg = room.config.games.find(g => g.type === 'sinperio')
  const allScoresFilled = Array.from({ length: 18 }, (_, i) => i + 1).every(
    h => room.holes[h]?.scores && playerIds.every(id => room.holes[h].scores[id] != null)
  )
  if (sinperioCfg && allScoresFilled && room.sinperioHoles.length > 0) {
    const sp = calcSinperio(room, sinperioCfg)
    sinperioDeltas = sp.deltas
    sinperioNetScores = sp.netScores
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

  return { holeResults, playerTotals, sinperioDeltas, sinperioNetScores, sinperioTransfers, buddyResults, oecdResults, settlements }
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
