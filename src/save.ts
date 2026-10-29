import type { GameServices, SaveStore } from '@mg/core'
import { SNAKE_SKINS, type SnakeSkinId } from './skins'

export interface SnakeSettings {
  /** 0–1 multiplier on the base music volume. */
  readonly musicVolume: number
  /** 0–1 multiplier on every sound effect. */
  readonly sfxVolume: number
}

export interface SnakeSave {
  best: number
  plays: number
  /** Ad-reward super fruit waiting for the next run. */
  pendingSuper: boolean
  /** Skin ids unlocked by rewarded ads; default skins are always available. */
  unlockedSkins: readonly SnakeSkinId[]
  /** Fixed skin chosen by the player, or a new random skin each run. */
  activeSkin: SnakeSkinId | 'random'
  settings: SnakeSettings
}

export const DEFAULT_SETTINGS: SnakeSettings = {
  musicVolume: 0.8,
  sfxVolume: 1,
}

const isSkinId = (value: unknown): value is SnakeSkinId =>
  typeof value === 'string' && SNAKE_SKINS.some((skin) => skin.id === value)

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function sanitizeSettings(value: unknown): SnakeSettings {
  const old = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    musicVolume: clampUnit(old.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampUnit(old.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
  }
}

/** Exported for tests and for a future save-format bump. */
export function sanitizeSnakeSave(value: unknown): SnakeSave | null {
  if (typeof value !== 'object' || value === null) return null
  const old = value as Record<string, unknown>
  if (typeof old.best !== 'number' || typeof old.plays !== 'number') return null

  const rawSkins = Array.isArray(old.unlockedSkins) ? old.unlockedSkins.filter(isSkinId) : []
  return {
    best: Math.max(0, old.best),
    plays: Math.max(0, old.plays),
    pendingSuper: old.pendingSuper === true,
    unlockedSkins: [...new Set(rawSkins)],
    activeSkin: old.activeSkin === 'random' || isSkinId(old.activeSkin) ? old.activeSkin : 'random',
    settings: sanitizeSettings(old.settings),
  }
}

let store: SaveStore<SnakeSave> | null = null

export function snakeSave(services: GameServices): SaveStore<SnakeSave> {
  store ??= services.createSave<SnakeSave>({
    name: 'save',
    version: 1,
    initial: () => ({
      best: 0,
      plays: 0,
      pendingSuper: false,
      unlockedSkins: [],
      activeSkin: 'random',
      settings: { ...DEFAULT_SETTINGS },
    }),
    migrate: (value) => sanitizeSnakeSave(value),
  })
  return store
}
