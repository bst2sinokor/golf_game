export type GameType = 'stroke' | 'team-match' | 'jootanwootan' | 'hussein' | 'sinperio' | 'scratch'

export const GAME_LABELS: Record<GameType, string> = {
  stroke: '스트로크',
  'team-match': '팀 매치플레이',
  jootanwootan: '좌탄우탄',
  hussein: '후세인',
  sinperio: '신페리오 핸디캡',
  scratch: '스크레치',
}

export interface PlayerConfig {
  id: string
  name: string
  isHost: boolean
  initialAmount: number
}

export interface GameConfig {
  type: GameType
  holes: number[]         // 1~18
  betPerHole?: number     // stroke, team-match, jootanwootan, hussein
  betPerStroke?: number   // scratch
  totalBet?: number       // sinperio
  teams?: [string[], string[]] // team-match: [team1 playerIds, team2 playerIds]
}

export interface OecdConfig {
  enabled: boolean
  threshold: number        // OECD 가입 기준 (누적 획득금액)
  penaltyPerEvent: number  // 이벤트당 페널티
  maxPerHole: number       // 홀당 페널티 상한
}

export interface RoomConfig {
  holePars: number[]       // 18개 홀 파 (인덱스 0 = 1홀)
  games: GameConfig[]
  oecd: OecdConfig
}

export interface OecdEvents {
  ob: number
  hazard: number
  bunker: number
  threePutt: boolean
  tripleOrWorse: boolean
}

export interface HoleData {
  scores: Record<string, number>
  oecd: Record<string, OecdEvents>
  jootanwootan: Record<string, 'left' | 'right'>
}

export type RoomStatus = 'waiting' | 'playing' | 'finished'

export interface Room {
  id: string
  status: RoomStatus
  hostPlayerId: string
  players: Record<string, PlayerConfig>
  config: RoomConfig
  holes: Record<number, HoleData>
  sinperioHoles: number[]  // 신페리오용 무작위 선정 6홀
  currentHole: number
  createdAt: number
}

// 계산 결과 타입
export interface HoleGameResult {
  game: GameType
  winners: string[]        // 승자 player id 목록
  loserPays: number        // 패자 1인당 부담금
  carry: boolean           // 이월 여부
  carryTotal: number       // 현재까지 누적 이월 판돈
  detail: string           // 표시용 설명
}

export interface PlayerTotals {
  gameAmount: number       // 게임 손익 합계
  oecdPenalty: number      // OECD 페널티 합계
  net: number              // 최종 손익
  isOecd: boolean          // OECD 가입 여부
}

export interface Settlement {
  from: string
  to: string
  amount: number
}
