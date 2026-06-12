export type GameType = 'stroke' | 'team-match' | 'jootanwootan' | 'hussein' | 'sinperio' | 'scratch' | 'lasvegas'

export const GAME_LABELS: Record<GameType, string> = {
  stroke: '스트로크',
  'team-match': '팀 매치플레이',
  jootanwootan: '좌탄우탄',
  hussein: '후세인',
  sinperio: '신페리오 핸디캡',
  scratch: '스크레치',
  lasvegas: '라스베가스',
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
  teams?: { team1: string[]; team2: string[] } // team-match
}

export interface OecdConfig {
  enabled: boolean
  threshold: number        // OECD 가입 기준 (내 보유액: 기본분배 + 승리금 + 버디 손익 − 페널티)
  penaltyPerEvent: number  // 이벤트당 페널티
  maxPerHole: number       // 홀당 페널티 상한
}

export interface BuddyConfig {
  enabled: boolean
  baseDistribution: number // 기본금액 분배 (첫 홀 시작 시 인당 지급)
  buddyValue: number       // 버디값 (버디 달성 시 나머지 인당 지급)
  collectFromTeammates?: boolean // 같은 팀에게도 버디값 받기 (기본 false: 해당 홀 팀 게임의 같은 팀원 제외)
}

export interface RoomConfig {
  holePars: number[]       // 18개 홀 파 (인덱스 0 = 1홀)
  games: GameConfig[]
  oecd: OecdConfig
  buddy?: BuddyConfig
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
  husseinPlayerId?: string     // 진행자 직접 지정 후세인
  lasvegasTeamA?: string[]     // 진행자 직접 지정 팀A (나머지가 팀B)
}

export type RoomStatus = 'waiting' | 'playing' | 'finished'

export interface Room {
  id: string
  status: RoomStatus
  hostPlayerId: string
  players: Record<string, PlayerConfig>
  playerOrder?: string[]   // 진행자가 지정한 플레이어 표시 순서 (player id 배열)
  config: RoomConfig
  holes: Record<number, HoleData>
  sinperioHoles: number[]  // 신페리오용 무작위 선정 6홀
  teeOrder?: string[]      // 1번홀 티샷 순서 (게임 시작 시 랜덤 생성)
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
  gameAmount: number       // 게임 손익 합계 (정산용, 승패 모두 반영)
  walletGains: number      // 게임 승리금 합계 (은행→지갑, 승리분만)
  buddyNet: number         // 버디값 손익 합계 (지갑↔지갑)
  baseDistribution: number // 기본금액 분배 (시작 지급액)
  oecdPenalty: number      // OECD 페널티 합계 (지갑→은행)
  wallet: number           // 내 보유 = baseDistribution + walletGains + buddyNet - oecdPenalty
  net: number              // 정산용 = baseDistribution + gameAmount + buddyNet - oecdPenalty
  isOecd: boolean          // OECD 가입 여부
}

export interface Settlement {
  from: string
  to: string
  amount: number
}
