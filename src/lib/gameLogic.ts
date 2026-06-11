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
  const pot = (cfg.betPerHole ?? 0) + prevCarry
  if (ranks[0].length > 1) {
    return {
      game: 'stroke', winners: [], loserPays: 0,
      carry: true, carryTotal: pot,
      detail: `동점 이월 (누적 ${pot.toLocaleString()}원)`,
    }
  }
  const [winner] = ranks[0]
  const others = Object.keys(scores).filter(id => id !== winner)
  return {
    game: 'stroke', winners: [winner],
    loserPays: Math.floor(pot / others.length),
    carry: false, carryTotal: 0,
    detail: `${winner} 승 (+${pot.toLocaleString()}원)`,
  }
}

// ─── 팀 매치플레이 ───────────────────────────────────────────────────────────

function calcTeamMatch(
  scores: Record<string, number>,
  cfg: GameConfig,
  prevCarry: number,
): HoleGameResult {
  const [team1, team2] = cfg.teams ?? [[], []]
  const t1sum = team1.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const t2sum = team2.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const pot = (cfg.betPerHole ?? 0) + prevCarry

  if (t1sum === t2sum) {
    return {
      game: 'team-match', winners: [], loserPays: 0,
      carry: true, carryTotal: pot,
      detail: `동점 이월 (누적 ${pot.toLocaleString()}원)`,
    }
  }
  const winTeam = t1sum < t2sum ? team1 : team2
  const loseTeam = t1sum < t2sum ? team2 : team1
  const perPerson = Math.floor(pot / winTeam.length)
  return {
    game: 'team-match', winners: winTeam,
    loserPays: Math.floor(pot / loseTeam.length),
    carry: false, carryTotal: 0,
    detail: `${winTeam.join('+')} 팀 승 (1인당 +${perPerson.toLocaleString()}원)`,
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
  const pot  = (cfg.betPerHole ?? 0) + prevCarry

  if (lsum === rsum) {
    return {
      game: 'jootanwootan', winners: [], loserPays: 0,
      carry: true, carryTotal: pot,
      detail: `동점 이월 (누적 ${pot.toLocaleString()}원)`,
    }
  }
  const winTeam  = lsum < rsum ? leftIds  : rightIds
  const loseTeam = lsum < rsum ? rightIds : leftIds
  const side = lsum < rsum ? '좌탄' : '우탄'
  return {
    game: 'jootanwootan', winners: winTeam,
    loserPays: Math.floor(pot / loseTeam.length),
    carry: false, carryTotal: 0,
    detail: `${side} 팀 승 (1인당 +${Math.floor(pot / winTeam.length).toLocaleString()}원)`,
  }
}

// ─── 후세인 ──────────────────────────────────────────────────────────────────

function findPrevRanking(room: Room, currentHole: number): string[] | null {
  for (let h = currentHole - 1; h >= 1; h--) {
    const holeData = room.holes[h]
    if (!holeData?.scores || Object.keys(holeData.scores).length < Object.keys(room.players).length) continue
    const ranks = rankPlayers(holeData.scores)
    if (ranks[0].length === 1) {
      // 1등 1명이면 명확한 순위 존재
      const ordered: string[] = []
      ranks.forEach(group => group.forEach(id => ordered.push(id)))
      return ordered
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
  const prevRank = findPrevRanking(room, hole)
  if (!prevRank || prevRank.length < 4) {
    return {
      game: 'hussein', winners: [], loserPays: 0,
      carry: false, carryTotal: 0,
      detail: '이전 홀 순위 없음 (적용 불가)',
    }
  }

  const husseinId   = prevRank[1]                          // 2등
  const alliesIds   = [prevRank[0], prevRank[2], prevRank[3]] // 1,3,4등

  const husseinScore = (scores[husseinId] ?? 0) * 3
  const alliesScore  = alliesIds.reduce((s, id) => s + (scores[id] ?? 0), 0)
  const pot          = (cfg.betPerHole ?? 0) + prevCarry

  if (husseinScore === alliesScore) {
    return {
      game: 'hussein', winners: [], loserPays: 0,
      carry: true, carryTotal: pot,
      detail: `동점 이월 (누적 ${pot.toLocaleString()}원)`,
    }
  }

  if (husseinScore < alliesScore) {
    return {
      game: 'hussein', winners: [husseinId],
      loserPays: Math.floor(pot / alliesIds.length),
      carry: false, carryTotal: 0,
      detail: `후세인(${husseinId}) 독식 +${pot.toLocaleString()}원`,
    }
  } else {
    return {
      game: 'hussein', winners: alliesIds,
      loserPays: pot,
      carry: false, carryTotal: 0,
      detail: `연합군 승 (1인당 +${Math.floor(pot / alliesIds.length).toLocaleString()}원)`,
    }
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
): Record<string, number> {
  const { holePars } = room.config
  const selectedHoles = room.sinperioHoles
  const playerIds = Object.keys(room.players)
  const totalPar = holePars.reduce((s, p) => s + p, 0)
  const bet = cfg.totalBet ?? 0
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

  // 최저 넷 스코어 순 순위 → 판돈 배분
  const ranked = Object.entries(netScores).sort((a, b) => a[1] - b[1])
  const winnerNet  = ranked[0][1]
  const winners    = ranked.filter(([, s]) => s === winnerNet).map(([id]) => id)
  const losers     = ranked.filter(([, s]) => s !== winnerNet).map(([id]) => id)
  const totalLosers = losers.length
  const perWinner  = totalLosers > 0 ? Math.floor((bet * totalLosers) / winners.length) : 0

  const deltas: Record<string, number> = {}
  for (const pid of playerIds) {
    if (winners.includes(pid)) deltas[pid] = perWinner
    else deltas[pid] = -bet
  }
  return deltas
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
  settlements: Settlement[]
} {
  const playerIds = Object.keys(room.players)
  const gameDeltas: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const oecdPenalties: Record<string, number> = Object.fromEntries(playerIds.map(id => [id, 0]))
  const holeResults: Record<number, HoleGameResult[]> = {}
  let sinperioDeltas: Record<string, number> = {}

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
        result = calcTeamMatch(scores, cfg, prevCarry)
      } else if (cfg.type === 'jootanwootan') {
        result = calcJootanwootan(scores, holeData.jootanwootan ?? {}, cfg, prevCarry)
      } else if (cfg.type === 'hussein') {
        result = calcHussein(h, scores, cfg, room, prevCarry)
      }

      if (result) {
        if (result.carry) {
          carryMap[cfg.type] = result.carryTotal
        } else {
          carryMap[cfg.type] = 0
          const losers = playerIds.filter(id => !result!.winners.includes(id))
          for (const wid of result.winners) {
            gameDeltas[wid] += result.loserPays * losers.length / result.winners.length
          }
          for (const lid of losers) {
            gameDeltas[lid] -= result.loserPays
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
      }
      results.push({
        game: 'scratch', winners: [], loserPays: 0,
        carry: false, carryTotal: 0,
        detail: '스크레치 홀별 정산',
      })
    }

    // OECD 페널티
    const oecdCfg = room.config.oecd
    if (oecdCfg.enabled) {
      for (const pid of playerIds) {
        const events  = holeData.oecd?.[pid]
        const running = gameDeltas[pid] + (room.players[pid]?.initialAmount ?? 0)
        const isOecd  = running >= oecdCfg.threshold
        if (isOecd && events) {
          const penalty = calcOecdPenalty(pid, events, holePar, scores[pid] ?? holePar, oecdCfg)
          oecdPenalties[pid] += penalty
        }
      }
    }

    holeResults[h] = results
  }

  // 신페리오 (라운드 완료 시)
  const sinperioCfg = room.config.games.find(g => g.type === 'sinperio')
  const allScoresFilled = Array.from({ length: 18 }, (_, i) => i + 1).every(
    h => room.holes[h]?.scores && playerIds.every(id => room.holes[h].scores[id] != null)
  )
  if (sinperioCfg && allScoresFilled && room.sinperioHoles.length > 0) {
    sinperioDeltas = calcSinperio(room, sinperioCfg)
    for (const [id, d] of Object.entries(sinperioDeltas)) {
      gameDeltas[id] = (gameDeltas[id] ?? 0) + d
    }
  }

  // 플레이어 최종 손익
  const playerTotals: Record<string, PlayerTotals> = {}
  for (const pid of playerIds) {
    const gameDelta  = gameDeltas[pid] ?? 0
    const penalty    = oecdPenalties[pid] ?? 0
    const net        = gameDelta - penalty
    const running    = (room.players[pid]?.initialAmount ?? 0) + net
    const isOecd     = running >= (room.config.oecd.threshold ?? Infinity)
    playerTotals[pid] = { gameAmount: gameDelta, oecdPenalty: penalty, net, isOecd }
  }

  // 최소 이체 정산
  const settlements = minimizeSettlements(playerTotals, room.players)

  return { holeResults, playerTotals, sinperioDeltas, settlements }
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
