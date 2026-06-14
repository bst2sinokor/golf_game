import {
  doc, setDoc, onSnapshot, updateDoc, getDoc, getDocFromServer, deleteField,
  collection, query, where, getDocs, deleteDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Room, HoleData, RoomConfig } from './types'
import { selectSinperioHoles } from './gameLogic'

function roomRef(roomId: string) {
  return doc(db, 'rooms', roomId)
}

function generateRoomId(): string {
  const chars = '0123456789'
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// 생성된 지 7일 지난 방 자동 삭제
async function cleanupOldRooms(): Promise<void> {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const q = query(collection(db, 'rooms'), where('createdAt', '<', cutoff))
    const snap = await getDocs(q)
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  } catch { /* 정리 실패는 방 생성에 영향 없음 */ }
}

export async function createRoom(hostName: string): Promise<{ roomId: string; playerId: string }> {
  void cleanupOldRooms()  // 백그라운드 정리 (대기하지 않음)

  // 코드 충돌 방지: 기존 방과 겹치지 않는 코드가 나올 때까지 재시도
  let roomId = generateRoomId()
  let ok = false
  for (let i = 0; i < 10; i++) {
    const snap = await getDoc(roomRef(roomId))
    if (!snap.exists()) { ok = true; break }
    roomId = generateRoomId()
  }
  if (!ok) throw new Error('방 코드 생성 실패')

  const playerId = 'host-' + Date.now()

  const defaultConfig: RoomConfig = {
    holePars: Array(18).fill(4),
    games: [],
    oecd: {
      enabled: false,
      lastHoleRelease: true,
      threshold: 60000,
      penaltyPerEvent: 10000,
      maxPerHole: 20000,
    },
    buddy: {
      enabled: false,
      baseDistribution: 0,
      buddyValue: 0,
      collectFromTeammates: false,
    },
    nearest: { enabled: false, holes: [], amount: 10000 },
    longest: { enabled: false, holes: [], amount: 10000 },
  }

  const room: Room = {
    id: roomId,
    status: 'waiting',
    hostPlayerId: playerId,
    players: {
      [playerId]: {
        id: playerId,
        name: hostName,
        isHost: true,
        initialAmount: 0,
      },
    },
    config: defaultConfig,
    holes: {},
    sinperioHoles: [],
    currentHole: 1,
    createdAt: Date.now(),
  }

  await setDoc(roomRef(roomId), room)
  return { roomId, playerId }
}

export async function joinRoom(
  roomId: string,
  playerName: string,
): Promise<{ playerId: string } | { error: string }> {
  const snap = await getDoc(roomRef(roomId))
  if (!snap.exists()) return { error: '방을 찾을 수 없습니다.' }

  const room = snap.data() as Room
  const existing = Object.values(room.players).find(p => p.name === playerName)
  if (existing) return { playerId: existing.id }

  const playerId = 'player-' + Date.now()
  await updateDoc(roomRef(roomId), {
    [`players.${playerId}`]: {
      id: playerId,
      name: playerName,
      isHost: false,
      initialAmount: 0,
    },
  })
  return { playerId }
}

export async function saveConfig(roomId: string, config: RoomConfig): Promise<void> {
  const hasSinperio = config.games.some(g => g.type === 'sinperio')
  const sinperioHoles = hasSinperio ? selectSinperioHoles(config.holePars) : []
  await updateDoc(roomRef(roomId), { config, sinperioHoles })
}

export async function startGame(roomId: string): Promise<void> {
  // 1번홀 티샷 순서 랜덤 생성 (Fisher-Yates)
  const snap = await getDoc(roomRef(roomId))
  const teeOrder = snap.exists() ? Object.keys((snap.data() as Room).players) : []
  for (let i = teeOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[teeOrder[i], teeOrder[j]] = [teeOrder[j], teeOrder[i]]
  }
  await updateDoc(roomRef(roomId), { status: 'playing', teeOrder })
}

export async function saveHoleData(
  roomId: string,
  hole: number,
  data: Partial<HoleData>,
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (data.scores) {
    for (const [pid, score] of Object.entries(data.scores)) {
      updates[`holes.${hole}.scores.${pid}`] = score
    }
  }
  if (data.oecd) {
    for (const [pid, events] of Object.entries(data.oecd)) {
      updates[`holes.${hole}.oecd.${pid}`] = events
    }
  }
  if (data.jootanwootan) {
    for (const [pid, dir] of Object.entries(data.jootanwootan)) {
      updates[`holes.${hole}.jootanwootan.${pid}`] = dir
    }
  }
  await updateDoc(roomRef(roomId), updates)
}

export async function setCurrentHole(roomId: string, hole: number): Promise<void> {
  await updateDoc(roomRef(roomId), { currentHole: hole })
}

export async function setPlayerOrder(roomId: string, order: string[]): Promise<void> {
  await updateDoc(roomRef(roomId), { playerOrder: order })
}

export async function removePlayer(roomId: string, playerId: string, newOrder: string[]): Promise<void> {
  await updateDoc(roomRef(roomId), {
    [`players.${playerId}`]: deleteField(),
    playerOrder: newOrder,
  })
}

export async function savePlayerAmounts(roomId: string, amounts: Record<string, number>): Promise<void> {
  const updates: Record<string, unknown> = {}
  for (const [pid, amount] of Object.entries(amounts)) {
    updates[`players.${pid}.initialAmount`] = amount
  }
  if (Object.keys(updates).length > 0) await updateDoc(roomRef(roomId), updates)
}

export async function setEventWinner(
  roomId: string,
  hole: number,
  type: 'nearest' | 'longest',
  winner: string,  // player id 또는 'PASS'
): Promise<void> {
  await updateDoc(roomRef(roomId), { [`holes.${hole}.${type}Winner`]: winner })
}

export async function setHusseinOverride(roomId: string, hole: number, playerId: string): Promise<void> {
  await updateDoc(roomRef(roomId), { [`holes.${hole}.husseinPlayerId`]: playerId })
}

export async function setLasvegasTeamAOverride(roomId: string, hole: number, teamA: string[]): Promise<void> {
  await updateDoc(roomRef(roomId), { [`holes.${hole}.lasvegasTeamA`]: teamA })
}

export async function finishGame(roomId: string): Promise<void> {
  await updateDoc(roomRef(roomId), { status: 'finished' })
}

// ─── 골프장·코스 프리셋 (9홀 코스 단위로 파 저장/불러오기) ───────────────────

export interface CoursePreset {
  club: string
  course: string
  pars: number[]  // 9개 홀 파
}

function presetId(club: string, course: string): string {
  return `${club.trim()}__${course.trim()}`.replace(/\//g, '_')
}

export async function saveCoursePreset(club: string, course: string, pars: number[]): Promise<void> {
  if (!club.trim() || !course.trim() || pars.length !== 9) return
  await setDoc(doc(db, 'coursePresets', presetId(club, course)), {
    club: club.trim(), course: course.trim(), pars, updatedAt: Date.now(),
  })
}

export async function fetchCoursePresets(): Promise<CoursePreset[]> {
  try {
    const snap = await getDocs(collection(db, 'coursePresets'))
    return snap.docs
      .map(d => d.data() as CoursePreset)
      .filter(p => Array.isArray(p.pars) && p.pars.length === 9)
  } catch {
    return []
  }
}

// 골프장+전반+후반 조합 (원터치 칩 선택용)
export interface CourseCombo {
  club: string
  frontCourse: string
  backCourse: string
}

export async function saveCourseCombo(club: string, frontCourse: string, backCourse: string): Promise<void> {
  if (!club.trim() || !frontCourse.trim() || !backCourse.trim()) return
  const id = `${club.trim()}__${frontCourse.trim()}__${backCourse.trim()}`.replace(/\//g, '_')
  await setDoc(doc(db, 'courseCombos', id), {
    club: club.trim(), frontCourse: frontCourse.trim(), backCourse: backCourse.trim(), updatedAt: Date.now(),
  })
}

export async function fetchCourseCombos(): Promise<CourseCombo[]> {
  try {
    const snap = await getDocs(collection(db, 'courseCombos'))
    return snap.docs.map(d => d.data() as CourseCombo)
  } catch {
    return []
  }
}

// 화면 복귀 시 서버에서 최신 상태 강제 조회 (모바일 절전 후 동기화 지연 대응)
export async function fetchRoomFromServer(roomId: string): Promise<Room | null> {
  try {
    const snap = await getDocFromServer(roomRef(roomId))
    return snap.exists() ? (snap.data() as Room) : null
  } catch {
    return null
  }
}

export function subscribeRoom(
  roomId: string,
  onUpdate: (room: Room) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    roomRef(roomId),
    snap => { if (snap.exists()) onUpdate(snap.data() as Room) },
    onError,
  )
}
