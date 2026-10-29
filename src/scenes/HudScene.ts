import {
  Button,
  cssColor,
  displayTextStyle,
  getServices,
  Modal,
  type ModalAction,
  onLayoutChange,
  readViewport,
  textStyle,
  type Viewport,
} from '@mg/core'
import Phaser from 'phaser'
import { canOfferSuperReward, grantSuperReward } from '../ads'
import { syncMusic } from '../audio/music'
import { playSfx } from '../audio/sfx'
import { snakeColors } from '../colors'
import { CloseButton } from '../ui/CloseButton'
import { playGameOverEffects, spawnCrown } from '../ui/celebration'
import { hostHudSafeTop } from '../ui/device'
import { fruitDecoration } from '../ui/fruitDecoration'
import {
  computeGameOverOverlay,
  computeSnakeLayout,
  GAME_OVER_MODAL_HEIGHT,
  GAME_OVER_MODAL_WIDTH,
  type GameOverOverlay,
  inlineScorePositions,
  type Rect,
  SCORE_LABEL_SIZE,
  SCORE_VALUE_SIZE,
  type SnakeLayout,
} from '../ui/layout'
import { PauseButton } from '../ui/PauseButton'
import { type RestartOptions, shouldRestartGameOver } from '../ui/restartGate'
import { resultMeta, resultTitle } from '../ui/resultCopy'
import { superOfferActions } from '../ui/superOfferActions'
import type { GameScene } from './GameScene'

export interface GameOverInfo {
  score: number
  best: number
  newBest: boolean
  won: boolean
  reason: 'wall' | 'self' | 'win'
}

type ModalRequest = { kind: 'pause' } | { kind: 'over'; info: GameOverInfo }

export class HudScene extends Phaser.Scene {
  private layout!: SnakeLayout
  private scoreCloud!: Phaser.GameObjects.Graphics
  private scoreLabel!: Phaser.GameObjects.Text
  private scoreValue!: Phaser.GameObjects.Text
  private feastBar!: Phaser.GameObjects.Graphics
  private lastFeastKey = ''
  private pauseButton!: PauseButton
  private modal?: Modal
  private modalRequest?: ModalRequest
  private soundButton?: Button
  private closeButton?: CloseButton
  private crown?: Phaser.GameObjects.Container
  private lastScore = -1

  constructor() {
    super('Hud')
  }

  create(): void {
    const services = getServices()
    const theme = services.theme
    const stats = this.gameScene().currentStats()
    this.layout = computeSnakeLayout(readViewport(this), {
      safeTop: hostHudSafeTop(),
      gridWidth: stats.grid.cols,
      gridHeight: stats.grid.rows,
    })

    this.scoreCloud = this.add.graphics()
    this.scoreLabel = this.add
      .text(0, 0, services.i18n.t('hud.score'), textStyle(theme, SCORE_LABEL_SIZE, theme.textMuted))
      .setOrigin(0.5)
    this.scoreValue = this.add
      .text(
        0,
        0,
        String(stats.score),
        displayTextStyle(theme, SCORE_VALUE_SIZE, cssColor(theme.accentInk), true, 0, 4),
      )
      .setOrigin(0.5)

    this.feastBar = this.add.graphics()

    this.pauseButton = new PauseButton(this, this.layout.pause.x, this.layout.pause.y, theme, {
      size: 64,
      onClick: () => this.gameScene().pauseGame(),
    })

    this.applyLayout()
    onLayoutChange(this, (viewport) => this.handleLayout(viewport))
    this.lastScore = stats.score
  }

  update(): void {
    const stats = this.gameScene().currentStats()
    this.updateFeast(stats.feast)
    if (stats.score === this.lastScore) return
    this.lastScore = stats.score
    this.scoreValue.setText(String(stats.score))
    this.positionScore()
    this.tweens.killTweensOf(this.scoreValue)
    this.scoreValue.setScale(1)
    this.tweens.add({
      targets: this.scoreValue,
      scale: 1.08,
      duration: 110,
      yoyo: true,
      ease: 'Quad.out',
    })
  }

  showPause(): void {
    if (this.modal?.active) return
    this.modalRequest = { kind: 'pause' }
    this.buildPauseModal()
  }

  showGameOver(info: GameOverInfo): void {
    if (this.modal?.active) return
    this.modalRequest = { kind: 'over', info }
    const overlay = this.buildGameOverModal(info)
    playGameOverEffects(this, { rich: info.newBest || info.won, bursts: overlay.bursts })
    if (info.newBest) this.showCrown(overlay)
  }

  closeModal(): void {
    this.modal?.close()
    this.modal = undefined
    this.modalRequest = undefined
    this.destroyOverlay()
  }

  private handleLayout(viewport: Viewport): void {
    const stats = this.gameScene().currentStats()
    const next = computeSnakeLayout(viewport, {
      safeTop: hostHudSafeTop(),
      gridWidth: stats.grid.cols,
      gridHeight: stats.grid.rows,
    })
    if (layoutsEqual(next, this.layout)) return
    this.layout = next
    this.applyLayout()
    this.rebuildModal()
  }

  private applyLayout(): void {
    this.drawScoreCloud()
    this.positionScore()
    this.pauseButton.setPosition(this.layout.pause.x, this.layout.pause.y)
    this.feastBar.clear()
    this.lastFeastKey = ''

    const stats = this.gameScene().currentStats()
    this.updateFeast(stats.feast)
  }

  private updateFeast(feast: { remainingMs: number; totalMs: number } | null): void {
    if (!feast) {
      if (this.lastFeastKey !== '') {
        this.feastBar.clear()
        this.lastFeastKey = ''
      }
      return
    }

    const ratio = Math.max(0, Math.min(1, feast.remainingMs / feast.totalMs))
    const key = `${Math.ceil(feast.remainingMs / 100)}:${Math.round(ratio * 100)}`
    if (key === this.lastFeastKey) return
    this.lastFeastKey = key
    this.drawFeastBar(ratio)
  }

  private drawFeastBar(ratio: number): void {
    const { scoreCard } = this.layout
    const padding = 20
    const height = 6
    const width = scoreCard.width - padding * 2
    const x = scoreCard.x + padding
    const y = scoreCard.y + scoreCard.height - 16
    const theme = getServices().theme

    this.feastBar.clear()
    this.feastBar.fillStyle(theme.borderSoft, 0.4)
    this.feastBar.fillRoundedRect(x, y, width, height, height / 2)
    this.feastBar.fillStyle(snakeColors.art.superFruit.body, 1)
    this.feastBar.fillRoundedRect(x, y, Math.max(height, width * ratio), height, height / 2)
  }

  private drawScoreCloud(): void {
    const theme = getServices().theme
    const bounds = this.layout.scoreCard

    this.scoreCloud.clear()

    // The soft lift keeps the cloud a UI surface instead of backdrop scenery.
    fillCloudShape(this.scoreCloud, bounds, 6, theme.shadow, 0.08)
    fillCloudShape(this.scoreCloud, bounds, 0, theme.surface, 0.95)
  }

  private positionScore(): void {
    const { score } = this.layout

    if (score.mode === 'stacked') {
      this.scoreLabel.setOrigin(0.5).setPosition(score.x, score.labelY)
      this.scoreValue.setOrigin(0.5).setPosition(score.x, score.valueY)
      return
    }

    const { labelX, valueX } = inlineScorePositions(
      score.x,
      this.scoreLabel.width,
      this.scoreValue.width,
    )
    this.scoreLabel.setOrigin(0.5).setPosition(labelX, score.y)
    this.scoreValue.setOrigin(0.5).setPosition(valueX, score.y)
  }

  private rebuildModal(): void {
    const request = this.modalRequest
    if (!request || !this.modal?.active) return
    this.destroyOverlay()
    this.modal.close()
    this.modal = undefined
    if (request.kind === 'pause') {
      this.buildPauseModal()
      return
    }
    const overlay = this.buildGameOverModal(request.info)
    if (request.info.newBest) this.showCrown(overlay)
  }

  private buildPauseModal(): void {
    const services = getServices()
    const game = this.gameScene()

    this.modal = new Modal(this, services.theme, {
      title: services.i18n.t('pause.title'),
      titleRibbon: false,
      body: services.i18n.t('pause.body'),
      width: PAUSE_MODAL_WIDTH,
      height: PAUSE_MODAL_HEIGHT,
      titleFontSize: 36,
      bodyFontSize: 30,
      actionsLayout: 'column',
      actionWidth: 480,
      actionHeight: 92,
      actionFontSize: 30,
      actions: [
        {
          label: services.i18n.t('pause.resume'),
          icon: 'play',
          decoration: fruitDecoration,
          onClick: () => game.resumeGame(),
        },
        {
          label: services.i18n.t('pause.restart'),
          variant: 'soft',
          icon: 'restart',
          onClick: () => game.restartGame(),
        },
        {
          label: services.i18n.t('pause.menu'),
          variant: 'soft',
          icon: 'home',
          onClick: () => game.goToMenu(),
        },
      ],
    })

    this.soundButton = new Button(this, 0, 0, '', services.theme, {
      width: PAUSE_SOUND_SIZE,
      height: PAUSE_SOUND_SIZE,
      variant: 'soft',
      minHitSize: PAUSE_SOUND_HIT,
      fontSize: 30,
      icon: services.settings.value.sound ? 'soundOn' : 'soundOff',
      onClick: () => this.togglePauseSound(),
    }).setDepth(1100)
    this.positionPauseSound()
  }

  private positionPauseSound(): void {
    if (!this.soundButton) return
    const viewport = readViewport(this)
    const width = Math.min(PAUSE_MODAL_WIDTH, viewport.width - 48)
    const height = Math.min(PAUSE_MODAL_HEIGHT, viewport.height - 48)
    this.soundButton.setPosition(
      viewport.width / 2 - width / 2 + PAUSE_SOUND_INSET + PAUSE_SOUND_SIZE / 2,
      viewport.height / 2 - height / 2 + PAUSE_SOUND_INSET + PAUSE_SOUND_SIZE / 2,
    )
  }

  private togglePauseSound(): void {
    const services = getServices()
    const next = !services.settings.value.sound
    if (next) services.audio.unlock()
    else playSfx('click')
    services.setSound(next)
    syncMusic()
    this.soundButton?.setIcon(next ? 'soundOn' : 'soundOff')
  }

  private buildGameOverModal(info: GameOverInfo): GameOverOverlay {
    const services = getServices()
    const game = this.gameScene()
    const canOfferSuper = canOfferSuperReward(services)

    const overlay = computeGameOverOverlay(readViewport(this), {
      width: GAME_OVER_MODAL_WIDTH,
      height: GAME_OVER_MODAL_HEIGHT,
      titleFontSize: GAME_OVER_TITLE_SIZE,
      heroFontSize: GAME_OVER_HERO_SIZE,
    })

    const restart = (options?: RestartOptions): void => {
      // The ad callback may resolve after the player already closed the modal
      // or restarted. The reward path still has to start the next run, but an
      // ordinary restart only applies while its modal is open.
      if (!shouldRestartGameOver(this.modal?.active ?? false, options)) return
      void game.restartGame(options)
    }
    const actions: ModalAction[] = canOfferSuper
      ? superOfferActions({
          ads: services.ads,
          standardLabel: services.i18n.t('over.restart'),
          rewardedLabel: services.i18n.t('ads.super'),
          loadingLabel: services.i18n.t('ads.loading'),
          grant: () => grantSuperReward(services),
          restart,
        }).map((action, index) =>
          index === 0 ? { ...action, decoration: fruitDecoration } : action,
        )
      : [
          {
            label: services.i18n.t('over.restart'),
            icon: 'restart',
            decoration: fruitDecoration,
            onClick: restart,
          },
        ]

    this.modal = new Modal(this, services.theme, {
      title: resultTitle(services.i18n, info),
      titleRibbon: false,
      hero: String(info.score),
      body: resultMeta(services.i18n, info),
      width: GAME_OVER_MODAL_WIDTH,
      height: GAME_OVER_MODAL_HEIGHT,
      titleFontSize: GAME_OVER_TITLE_SIZE,
      heroFontSize: GAME_OVER_HERO_SIZE,
      bodyFontSize: GAME_OVER_META_SIZE,
      actionsLayout: 'column',
      actionGap: 16,
      actionWidth: 480,
      actionHeight: 64,
      actionFontSize: 24,
      actions,
    })
    // The meta line is a caption for the score, not body copy: keep it quiet so
    // the hero number stays the single focal point of the card.
    this.modal.bodyText?.setColor(services.theme.textMuted)

    this.closeButton = new CloseButton(this, overlay.close.x, overlay.close.y, services.theme, {
      size: overlay.closeSize,
      onClick: () => game.goToMenu(),
    }).setDepth(1100)

    return overlay
  }

  private showCrown(overlay: GameOverOverlay): void {
    this.crown = spawnCrown(this, {
      x: overlay.crown.x,
      y: overlay.crown.y,
      size: overlay.crownSize,
      theme: getServices().theme,
    })
  }

  private destroyOverlay(): void {
    if (this.soundButton) {
      this.tweens.killTweensOf(this.soundButton)
      this.soundButton.destroy()
      this.soundButton = undefined
    }
    if (this.closeButton) {
      this.tweens.killTweensOf(this.closeButton)
      this.closeButton.destroy()
      this.closeButton = undefined
    }
    if (this.crown) {
      this.tweens.killTweensOf(this.crown)
      this.crown.destroy()
      this.crown = undefined
    }
  }

  private gameScene(): GameScene {
    return this.scene.get('Game') as GameScene
  }
}

const PAUSE_MODAL_WIDTH = 640
const PAUSE_MODAL_HEIGHT = 500
const PAUSE_SOUND_SIZE = 56
const PAUSE_SOUND_HIT = 96
const PAUSE_SOUND_INSET = 24
const GAME_OVER_TITLE_SIZE = 32
const GAME_OVER_HERO_SIZE = 60
const GAME_OVER_META_SIZE = 24

function fillCloudShape(
  graphics: Phaser.GameObjects.Graphics,
  bounds: Rect,
  offsetY: number,
  color: number,
  alpha: number,
): void {
  const { x, y, width, height } = bounds
  const top = y + offsetY

  graphics.fillStyle(color, alpha)
  graphics.fillRoundedRect(
    x + width * 0.03,
    top + height * 0.36,
    width * 0.94,
    height * 0.56,
    height * 0.28,
  )
  graphics.fillCircle(x + width * 0.2, top + height * 0.44, height * 0.25)
  graphics.fillCircle(x + width * 0.42, top + height * 0.32, height * 0.3)
  graphics.fillCircle(x + width * 0.64, top + height * 0.34, height * 0.29)
  graphics.fillCircle(x + width * 0.82, top + height * 0.46, height * 0.22)
}

function layoutsEqual(a: SnakeLayout, b: SnakeLayout): boolean {
  return (
    a.board.x === b.board.x &&
    a.board.y === b.board.y &&
    a.board.width === b.board.width &&
    a.hud.x === b.hud.x &&
    a.hud.y === b.hud.y &&
    a.hud.width === b.hud.width &&
    a.hud.height === b.hud.height
  )
}
