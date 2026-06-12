import {
  doc, setDoc, onSnapshot, updateDoc, getDoc, deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Room, HoleData, RoomConfig } from './types'
import { selectSinperioHoles } from './gameLogic'

function roomRef(roomId: string) {
  return doc(db, 'rooms', roomId)
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function createRoom(hostName: string): Promise<{ roomId: string; playerId: string }> {
  const roomId   = generateRoomId()
  const playerId = 'host-' + Date.now()

  const defaultConfig: RoomConfig = {
    holePars: Array(18).fill(4),
    games: [],
    oecd: {
      enabled: false,
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
  await updateDoc(roomRef(roomId), { status: 'playing' })
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

export async function setHusseinOverride(roomId: string, hole: number, playerId: string): Promise<void> {
  await updateDoc(roomRef(roomId), { [`holes.${hole}.husseinPlayerId`]: playerId })
}

export async function setLasvegasTeamAOverride(roomId: string, hole: number, teamA: string[]): Promise<void> {
  await updateDoc(roomRef(roomId), { [`holes.${hole}.lasvegasTeamA`]: teamA })
}

export async function finishGame(roomId: string): Promise<void> {
  await updateDoc(roomRef(roomId), { status: 'finished' })
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
