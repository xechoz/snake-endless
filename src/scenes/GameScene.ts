import {
  DebugOverlay,
  displayTextStyle,
  getServices,
  onAppHidden,
  onLayoutChange,
  randomSeed,
  readViewport,
  type Theme,
  type Viewport,
} from '@mg/core'
import { createRng, type Rng } from '@mg/core/rng'
import Phaser from 'phaser'
import { takeSuperReward } from '../ads'
import { startMusic, syncMusic } from '../audio/music'
import { playSfx } from '../audio/sfx'
import { snakeConfig } from '../logic/config'
import {
  cellKey,
  createInitialState,
  enqueueDirection,
  grantSuperItem,
  step,
  tickMs,
} from '../logic/state'
import type { Cell, Direction, FruitKind, SnakeState } from '../logic/types'
import { snakeSave } from '../save'
import { resolveSkin, type SnakeSkinId, startingSegmentColors } from '../skins'
import { drawBackdrop } from '../ui/backdrop'
import { hostHudSafeTop } from '../ui/device'
import { FoodLayer } from '../ui/FoodLayer'
import {
  flashDanger,
  showEatFeedback,
  showFeastEndFeedback,
  showFeastFeedback,
  showPowerUpFeedback,
} from '../ui/feedback'
import {
  COUNTDOWN_STEP_ANGLE,
  drawCountdownBackdrop,
  drawCountdownFruits,
  drawPickups,
  drawSnake,
} from '../ui/gameArt'
import { drawGardenBoard, drawPaintTrail } from '../ui/gardenArt'
import { computeSnakeLayout, type SnakeLayout } from '../ui/layout'
import { OrchardAmbience } from '../ui/orchardAmbience'
import { SwipeSteer } from '../ui/SwipeSteer'
import type { SceneryRect } from '../ui/scenery'
import type { GameOverInfo, HudScene } from './HudScene'

const COUNTDOWN_STEP_MS = 1000
const COUNTDOWN_STEPS = 3
const COUNTDOWN_MS = COUNTDOWN_STEP_MS * COUNTDOWN_STEPS
const GAME_OVER_DELAY_MS = 700
const COMBO_WINDOW_MS = 1200
/** Major pentatonic ladder for consecutive eats, the "do-re-mi" feel of Yoshi fruit chains. */
const EAT_STEPS = [0, 2, 4, 7, 9, 12, 14, 16]
/** Feast bites are dense; keep them quiet and skip overlapping retriggers. */
const FEAST_EAT_GAIN = 0.35
const FEAST_EAT_MIN_MS = 240
/** Cap the feast pitch ladder at +7 semitones so long feasts never turn shrill. */
const FEAST_EAT_MAX_STEP = 4

export interface RunStats {
  readonly score: number
  readonly feast: { remainingMs: number; totalMs: number } | null
  readonly grid: { readonly cols: number; readonly rows: number }
}

export class GameScene extends Phaser.Scene {
  private state!: SnakeState
  private rng!: Rng
  private viewport!: Viewport
  private layout!: SnakeLayout
  private prevCells: Cell[] = []
  private painted = new Map<number, FruitKind | null>()
  private paintDirty = true
  private elapsed = 0
  private paused = false
  private finished = false
  private resuming = false
  private restarting = false
  private countdownActive = false
  private countdownMs = 0
  private best = 0
  private newBest = false
  /** Consecutive eats within COMBO_WINDOW_MS, transposed up for the eat sound. */
  private eatChain = 0
  private lastEatAt = Number.NEGATIVE_INFINITY
  /** Last quiet feast bite, used to avoid stacking the 230ms crunch samples. */
  private lastFeastEatAt = Number.NEGATIVE_INFINITY
  private backdropGraphics!: Phaser.GameObjects.Graphics
  private boardGraphics!: Phaser.GameObjects.Graphics
  private paintGraphics!: Phaser.GameObjects.Graphics
  private seedGraphics!: Phaser.GameObjects.Graphics
  private snakeGraphics!: Phaser.GameObjects.Graphics
  private foodLayer!: FoodLayer
  private powerUpGraphics!: Phaser.GameObjects.Graphics
  private superGraphics!: Phaser.GameObjects.Graphics
  private lastFoods: SnakeState['foods'] | null = null
  private countdownBadge!: Phaser.GameObjects.Graphics
  private countdownFruits!: Phaser.GameObjects.Graphics
  private countdownArt!: Phaser.GameObjects.Container
  /** Tween proxy for the fruit wreath's current rotation. */
  private readonly countdownRing = { angle: 0 }
  private countdownText!: Phaser.GameObjects.Text
  private debugOverlay?: DebugOverlay
  private removeHiddenListener?: () => void
  private ambience?: OrchardAmbience
  private steer!: SwipeSteer

  constructor() {
    super('Game')
  }

  create(): void {
    const services = getServices()
    const theme = services.theme
    startMusic(this)
    this.cameras.main.setBackgroundColor(theme.bg)
    this.viewport = readViewport(this)
    const grid = this.grid()
    this.layout = computeSnakeLayout(this.viewport, {
      safeTop: hostHudSafeTop(),
      gridWidth: grid.cols,
      gridHeight: grid.rows,
    })

    this.backdropGraphics = this.add.graphics().setDepth(-2)
    this.drawBackdrop()

    this.boardGraphics = this.add.graphics().setDepth(0)
    this.paintGraphics = this.add.graphics().setDepth(1)
    this.seedGraphics = this.add.graphics().setDepth(2)
    this.drawBoard()

    this.snakeGraphics = this.add.graphics().setDepth(4)
    this.foodLayer = new FoodLayer(this, theme)
    this.powerUpGraphics = this.add.graphics().setDepth(5)
    this.superGraphics = this.add.graphics().setDepth(6)

    this.countdownBadge = this.add.graphics()
    this.countdownFruits = this.add.graphics()
    drawCountdownBackdrop(this.countdownBadge, 0, 0, theme)
    this.drawCountdownRing()
    this.countdownArt = this.add
      .container(0, 0, [this.countdownBadge, this.countdownFruits])
      .setDepth(11)
      .setAlpha(0)
    this.countdownText = this.add
      .text(0, 0, '', displayTextStyle(theme, 96, theme.text, true, 0, 5))
      .setOrigin(0.5)
      .setDepth(12)
      .setAlpha(0)
    this.positionCountdown()

    this.steer = new SwipeSteer(this, theme, (direction) => this.inputDirection(direction))
    this.steer.setBlockedRect(this.layout.hud)
    this.resetGame()
    this.bindInput()
    this.scene.launch('Hud')

    if (services.debug) this.debugOverlay = new DebugOverlay(this, theme)

    this.removeHiddenListener = onAppHidden(() => {
      if (this.isPlaying()) this.pauseGame()
    })

    onLayoutChange(this, (viewport) => this.handleLayout(viewport))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeHiddenListener?.()
      this.ambience?.destroy()
      this.foodLayer.destroy()
    })
  }

  update(_time: number, delta: number): void {
    syncMusic()
    const frame = Math.min(delta, 250)
    this.debugOverlay?.update(
      frame,
      `score=${this.state.score} len=${this.state.snake.length} status=${this.state.status}`,
    )

    if (this.paused) {
      this.render(this.progress())
      return
    }

    if (this.countdownActive) {
      const previous = Math.ceil(this.countdownMs / COUNTDOWN_STEP_MS)
      this.countdownMs -= frame
      if (this.countdownMs <= 0) {
        this.countdownActive = false
        this.tweens.killTweensOf(this.countdownRing)
        // The two-character "开始" needs a smaller face than a single digit.
        this.countdownText.setFontSize(56)
        this.countdownText.setText(getServices().i18n.t('go'))
        this.popCountdown()
        playSfx('start')
        this.tweens.add({
          targets: [this.countdownText, this.countdownArt],
          alpha: 0,
          duration: 320,
          delay: 180,
          onComplete: () => this.countdownText.setText(''),
        })
      } else {
        const current = Math.ceil(this.countdownMs / COUNTDOWN_STEP_MS)
        if (current !== previous) {
          const step = COUNTDOWN_STEPS - current + 1
          this.popCountdown()
          this.playCountdownTick(step)
          // Three beats: the ring steps when 3 appears, then with 2 and 1.
          this.stepCountdownRing(step)
        }
        this.countdownText.setText(String(current))
      }
      this.render(0)
      return
    }

    if (this.state.status !== 'alive') {
      this.render(1)
      return
    }

    this.elapsed += frame
    let guard = 0
    while (this.elapsed >= tickMs(this.state) && this.state.status === 'alive' && guard < 10) {
      this.elapsed -= tickMs(this.state)
      this.advance()
      guard += 1
    }

    if (this.state.status !== 'alive' && !this.finished) this.finish()
    this.render(this.progress())
  }

  currentStats(): RunStats {
    return {
      score: this.state.score,
      feast: this.state.feast
        ? {
            remainingMs: this.state.feast.remainingMs,
            totalMs: this.state.config.feastDurationMs,
          }
        : null,
      grid: this.grid(),
    }
  }

  inputDirection(direction: Direction): void {
    if (this.adsActive() || this.paused || this.finished || this.state.status !== 'alive') return
    const next = enqueueDirection(this.state, direction)
    if (next === this.state) return
    this.state = next
    playSfx('turn')
  }

  pauseGame(): void {
    if (this.adsActive() || this.paused || this.finished || this.state.status !== 'alive') return
    const services = getServices()
    this.paused = true
    this.countdownActive = false
    this.tweens.killTweensOf([this.countdownText, this.countdownArt, this.countdownRing])
    this.countdownText.setAlpha(0)
    this.countdownArt.setAlpha(0)
    this.steer.setEnabled(false)
    services.platform.gameplayStop()
    playSfx('pause')
    this.hud()?.showPause()
  }

  async resumeGame(): Promise<void> {
    if (this.resuming || this.adsActive() || !this.paused || this.finished) return
    this.resuming = true
    try {
      const services = getServices()
      this.hud()?.closeModal()
      if (!this.isPortalHost()) {
        await services.ads.showInterstitial()
      }
      this.paused = false
      this.steer.setEnabled(true)
      // The resume tap is a fresh user gesture; Safari may have interrupted the
      // audio context while the page was in the background.
      services.audio.unlock()
      this.startCountdown()
      services.platform.gameplayStart()
    } finally {
      this.resuming = false
    }
  }

  togglePause(): void {
    if (this.adsActive()) return
    if (this.paused) void this.resumeGame()
    else this.pauseGame()
  }

  async restartGame(options: { commercial?: boolean } = {}): Promise<void> {
    if (this.restarting || this.adsActive()) return
    this.restarting = true
    try {
      if (options.commercial !== false && !(this.isPortalHost() && this.paused)) {
        await getServices().ads.showInterstitial()
      }
      this.scene.stop('Hud')
      this.scene.restart()
    } finally {
      this.restarting = false
    }
  }

  goToMenu(): void {
    if (this.adsActive()) return
    this.scene.stop('Hud')
    this.scene.start('Menu')
  }

  private adsActive(): boolean {
    return getServices().ads.active
  }

  private isPortalHost(): boolean {
    return getServices().platform.name === 'crazygames'
  }

  private handleLayout(viewport: Viewport): void {
    const grid = this.grid()
    const next = computeSnakeLayout(viewport, {
      safeTop: hostHudSafeTop(),
      gridWidth: grid.cols,
      gridHeight: grid.rows,
    })
    if (layoutsEqual(next, this.layout) && !this.foodLayer.needsRebake()) return

    const rotated = next.orientation !== this.layout.orientation && this.isPlaying()
    this.layout = next
    this.viewport = viewport
    this.lastFoods = null
    this.paintDirty = true
    this.drawBackdrop()
    this.drawBoard()
    this.positionCountdown()
    this.steer.setBlockedRect(next.hud)

    if (rotated) this.pauseGame()
  }

  private resetGame(): void {
    const services = getServices()
    const save = snakeSave(services).read()
    this.best = save.best
    this.newBest = false
    this.rng = createRng(randomSeed())
    this.painted.clear()
    this.paintDirty = true

    const lastSkin = this.registry.get('lastSkin') as SnakeSkinId | undefined
    const skin = resolveSkin(this.rng, {
      unlocked: save.unlockedSkins,
      active: save.activeSkin,
      last: lastSkin,
    })
    this.registry.set('lastSkin', skin.id)
    const base = createInitialState(snakeConfig, this.rng, startingSegmentColors(skin.palette))
    this.state = takeSuperReward(services) ? grantSuperItem(base, this.rng) : base
    this.prevCells = [...this.state.snake]
    this.lastFoods = null
    this.elapsed = 0
    this.paused = false
    this.finished = false
    this.paintCell(this.state.snake[0], this.state.segmentColors[0] ?? null)
    this.steer.setEnabled(true)
    this.startCountdown()
    services.platform.gameplayStart()
  }

  private startCountdown(): void {
    this.tweens.killTweensOf([this.countdownText, this.countdownArt, this.countdownRing])
    this.resetEatChain()
    this.countdownActive = true
    this.countdownMs = COUNTDOWN_MS
    this.countdownRing.angle = 0
    this.drawCountdownRing()
    this.countdownText.setFontSize(96)
    this.countdownText.setText(String(Math.ceil(this.countdownMs / COUNTDOWN_STEP_MS)))
    this.countdownText.setAlpha(1).setScale(1)
    this.countdownArt.setAlpha(1)
    this.popCountdown()
    this.playCountdownTick(1)
    this.stepCountdownRing(1)
  }

  /** One short beep per countdown beat, rising above the menu's confirmation click. */
  private playCountdownTick(step: number): void {
    const pitch = 1.15 + (step - 1) * 0.15
    playSfx('click', { pitch, gain: 1.15 })
  }

  private stepCountdownRing(step: number): void {
    const target = step * COUNTDOWN_STEP_ANGLE
    this.tweens.killTweensOf(this.countdownRing)
    this.tweens.add({
      targets: this.countdownRing,
      angle: target,
      duration: 240,
      delay: 60,
      ease: 'Cubic.out',
      onUpdate: () => this.drawCountdownRing(),
      onComplete: () => {
        this.countdownRing.angle = target
        this.drawCountdownRing()
      },
    })
  }

  private drawCountdownRing(): void {
    drawCountdownFruits(this.countdownFruits, 0, 0, getServices().theme, this.countdownRing.angle)
  }

  private popCountdown(): void {
    this.tweens.killTweensOf(this.countdownText)
    this.countdownText.setScale(0.72)
    this.tweens.add({
      targets: this.countdownText,
      scale: 1,
      duration: 220,
      ease: 'Back.out',
    })
  }

  private advance(): void {
    const services = getServices()
    const oldCells = this.state.snake
    const wasFeast = this.state.feast !== null
    const result = step(this.state, this.rng)
    this.prevCells = result.state.snake.map((cell, index) => oldCells[index] ?? cell)
    this.state = result.state
    this.paintCell(result.state.snake[0], result.state.segmentColors[0] ?? null)

    for (const event of result.events) {
      if (event.type === 'eat') {
        const grew = result.state.snake.length > oldCells.length
        this.playEatSound(grew, wasFeast)
        showEatFeedback(this, this.layout.board, event.at, event.kind, event.points, services.theme)
      } else if (event.type === 'power') {
        playSfx(event.effect === 'fast' ? 'boost' : 'slow')
        const label = services.i18n.t(event.effect === 'fast' ? 'power.fast' : 'power.slow')
        showPowerUpFeedback(
          this,
          this.layout.board,
          event.at,
          event.kind,
          event.effect,
          label,
          services.theme,
        )
      } else if (event.type === 'feast') {
        this.resetEatChain()
        playSfx('start')
        showFeastFeedback(
          this,
          this.layout.board,
          event.at,
          services.i18n.t('feast.start'),
          services.theme,
        )
      } else if (event.type === 'feastEnd') {
        this.resetEatChain()
        playSfx('click')
        showFeastEndFeedback(this, this.layout.board, services.i18n.t('feast.end'), services.theme)
      } else if (event.type === 'die') {
        this.resetEatChain()
        playSfx('die')
        this.cameras.main.shake(220, 0.008)
        flashDanger(this, services.theme)
      } else if (event.type === 'win') {
        playSfx('start')
      }
    }

    if (this.state.score > this.best) {
      this.best = this.state.score
      this.newBest = true
      const save = snakeSave(services)
      save.write({ ...save.read(), best: this.state.score })
    }
  }

  private playEatSound(grew: boolean, feast: boolean): void {
    const now = this.time.now

    // During the feast most bites only score. Keep those quiet, fixed-pitch and
    // spaced so the 230ms crunch samples do not pile up into noise.
    if (feast && !grew) {
      if (now - this.lastFeastEatAt < FEAST_EAT_MIN_MS) return
      this.lastFeastEatAt = now
      playSfx('eat', { gain: FEAST_EAT_GAIN })
      return
    }

    this.eatChain =
      now - this.lastEatAt <= COMBO_WINDOW_MS
        ? Math.min(this.eatChain + 1, EAT_STEPS.length - 1)
        : 0
    this.lastEatAt = now
    if (feast) this.lastFeastEatAt = now
    const maxStep = feast ? FEAST_EAT_MAX_STEP : EAT_STEPS.length - 1
    const step = EAT_STEPS[Math.min(this.eatChain, maxStep)] ?? 0
    playSfx('eat', { pitch: 2 ** (step / 12) })
  }

  private resetEatChain(): void {
    this.eatChain = 0
    this.lastEatAt = Number.NEGATIVE_INFINITY
    this.lastFeastEatAt = Number.NEGATIVE_INFINITY
  }

  private finish(): void {
    const services = getServices()
    if (this.finished) return
    this.finished = true
    this.steer.setEnabled(false)
    services.platform.gameplayStop()

    const won = this.state.status === 'won'
    const save = snakeSave(services)
    const current = save.read()
    const isNewBest = this.newBest
    const best = Math.max(current.best, this.state.score)
    save.write({ ...current, best, plays: current.plays + 1 })
    this.best = best

    // One short pulse per run end; eating stays silent so the phone does not
    // buzz constantly during a good run.
    services.platform.haptic(isNewBest || won ? 40 : 24)

    if (isNewBest || won) services.platform.happyTime()

    const info: GameOverInfo = {
      score: this.state.score,
      best,
      newBest: isNewBest,
      won,
      reason: won ? 'win' : (this.state.deathReason ?? 'wall'),
    }
    this.time.delayedCall(GAME_OVER_DELAY_MS, () => {
      if (this.finished) this.hud()?.showGameOver(info)
    })
  }

  private progress(): number {
    if (this.state.status !== 'alive') return 1
    const interval = tickMs(this.state)
    return Math.min(1, this.elapsed / interval)
  }

  private render(progress: number): void {
    const theme = getServices().theme
    this.renderPaint(theme)
    this.seedGraphics.clear()

    drawSnake(
      this.snakeGraphics,
      this.state,
      this.prevCells,
      this.layout.board,
      progress,
      this.time.now,
      theme,
    )

    if (this.state.foods !== this.lastFoods) {
      this.foodLayer.sync(this.state.foods, this.layout.board, theme)
      this.lastFoods = this.state.foods
    }

    drawPickups(
      this.powerUpGraphics,
      this.superGraphics,
      this.state,
      this.layout.board,
      this.time.now,
      theme,
    )
  }

  private renderPaint(theme: Theme): void {
    if (!this.paintDirty) return
    drawPaintTrail(this.paintGraphics, this.layout.board, this.painted, this.grid().cols, theme)
    this.paintDirty = false
  }

  private paintCell(cell: Cell | undefined, kind: FruitKind | null): void {
    if (!cell) return
    const key = cellKey(cell, this.grid().cols)
    if (this.painted.has(key)) return
    this.painted.set(key, kind)
    this.paintDirty = true
  }

  private drawBackdrop(): void {
    const theme = getServices().theme
    const board = this.layout.board
    const hud = this.layout.hud
    const quiet: SceneryRect[] = [
      { x: board.x, y: board.y, width: board.width, height: board.height },
      { x: hud.x, y: hud.y, width: hud.width, height: hud.height },
    ]
    const plan = drawBackdrop(this.backdropGraphics, this.viewport, theme, {
      quiet,
      density: 'game',
    })
    this.ambience?.destroy()
    this.ambience = new OrchardAmbience(this, theme, plan, 'game').setDepth(-1)
  }

  private drawBoard(): void {
    const grid = this.grid()
    drawGardenBoard(
      this.boardGraphics,
      this.layout.board,
      grid.cols,
      grid.rows,
      [],
      getServices().theme,
    )
    this.seedGraphics.clear()
    this.paintDirty = true
  }

  private grid(): { cols: number; rows: number } {
    return { cols: snakeConfig.width, rows: snakeConfig.height }
  }

  private bindInput(): void {
    const keyboard = this.input.keyboard
    const bind = (key: string, direction: Direction): void => {
      keyboard?.on(`keydown-${key}`, () => this.inputDirection(direction))
    }

    bind('UP', 'up')
    bind('W', 'up')
    bind('DOWN', 'down')
    bind('S', 'down')
    bind('LEFT', 'left')
    bind('A', 'left')
    bind('RIGHT', 'right')
    bind('D', 'right')

    keyboard?.on('keydown-P', () => this.togglePause())
    keyboard?.on('keydown-ESC', () => this.togglePause())
    keyboard?.on('keydown-SPACE', () => this.togglePause())
    keyboard?.on('keydown-ENTER', () => {
      if (this.finished) this.restartGame()
      else if (this.paused) this.resumeGame()
    })
    keyboard?.on('keydown-R', () => {
      if (this.finished) this.restartGame()
    })
  }

  private positionCountdown(): void {
    const { x, y, width } = this.layout.board
    const centerX = x + width / 2
    const centerY = y + width / 2
    this.countdownText.setPosition(centerX, centerY)
    this.countdownArt.setPosition(centerX, centerY)
  }

  private hud(): HudScene | undefined {
    return this.scene.get('Hud') as HudScene | undefined
  }

  private isPlaying(): boolean {
    return !this.paused && !this.finished && this.state.status === 'alive'
  }
}

function layoutsEqual(a: SnakeLayout, b: SnakeLayout): boolean {
  return (
    a.orientation === b.orientation &&
    a.placement === b.placement &&
    a.board.x === b.board.x &&
    a.board.y === b.board.y &&
    a.board.width === b.board.width &&
    a.hud.x === b.hud.x &&
    a.hud.y === b.hud.y &&
    a.hud.width === b.hud.width &&
    a.hud.height === b.hud.height
  )
}
