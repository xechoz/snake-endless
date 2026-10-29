import {
  Button,
  cssColor,
  drawIcon,
  getServices,
  isEmbedded,
  isStandalone,
  LANG_SHORT,
  maybeEnterFullscreen,
  onLayoutChange,
  randomSeed,
  readViewport,
  textStyle,
  type Viewport,
} from '@mg/core'
import { createRng } from '@mg/core/rng'
import Phaser from 'phaser'
import { startMusic } from '../audio/music'
import { playSfx } from '../audio/sfx'
import { snakeColors } from '../colors'
import type { Direction } from '../logic/types'
import { snakeSave } from '../save'
import { resolveSkin, startingSegmentColors } from '../skins'
import { drawBackdrop } from '../ui/backdrop'
import { CollectionModal } from '../ui/CollectionModal'
import { DemoCoach } from '../ui/DemoCoach'
import { hasTouchInput } from '../ui/device'
import { fruitDecoration } from '../ui/fruitDecoration'
import { gearDecoration } from '../ui/gear'
import { LanguageModal } from '../ui/LanguageModal'
import {
  computeMenuLayout,
  MENU_PLAY_HEIGHT,
  MENU_SETTINGS_HIT,
  type MenuLayout,
  menuDemoTouchRect,
} from '../ui/layout'
import { createSnakeLogo, type SnakeLogo } from '../ui/logo'
import { createMenuDemo, type MenuDemo } from '../ui/menuDemo'
import { OrchardAmbience } from '../ui/orchardAmbience'
import { SettingsModal } from '../ui/SettingsModal'
import { SwipeSteer } from '../ui/SwipeSteer'
import type { SceneryRect } from '../ui/scenery'

const CONTROL_ICON_DESKTOP = 160
const CONTROL_ICON_TOUCH = 56
const BEST_BADGE = 42
const PLAY_GLOW_PADDING = 16
const PLAY_FONT_SIZE = 34
const SETTINGS_ICON_SIZE = 30
const SETTINGS_LABEL_SIZE = 26

type HintKey = 'menu.controlsTouch' | 'menu.controlsTouchTry' | 'menu.controlsDesktop'

export class MenuScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.Graphics
  private logo!: SnakeLogo
  private bestLabel!: Phaser.GameObjects.Text
  private bestStar!: Phaser.GameObjects.Graphics
  private playGlow!: Phaser.GameObjects.Graphics
  private playButton!: Button
  private playWidth = 0
  private collectionButton!: Button
  private settingsButton!: Button
  private languageButton!: Button
  private collectionModal?: CollectionModal
  private languageModal?: LanguageModal
  private settingsModal?: SettingsModal
  private ambience?: OrchardAmbience
  private demo!: MenuDemo
  private hint!: Phaser.GameObjects.Text
  private controlsIcon!: Phaser.GameObjects.Graphics
  private installHint?: Phaser.GameObjects.Text
  private touch = false
  private showInstallHint = false
  private controlIconWidth = CONTROL_ICON_TOUCH
  private layout!: MenuLayout
  private steer!: SwipeSteer
  private coach!: DemoCoach
  private hintKey: HintKey = 'menu.controlsTouch'

  constructor() {
    super('Menu')
  }

  create(): void {
    const services = getServices()
    const theme = services.theme
    startMusic(this)
    const save = snakeSave(services).read()
    const menuSkin = resolveSkin(createRng(randomSeed()), {
      unlocked: save.unlockedSkins,
      active: save.activeSkin,
    })
    const viewport = readViewport(this)
    this.touch = hasTouchInput()
    this.showInstallHint = this.shouldShowInstallHint()
    this.controlIconWidth = this.touch ? CONTROL_ICON_TOUCH : CONTROL_ICON_DESKTOP

    services.platform.gameplayStop()

    this.cameras.main.setBackgroundColor(theme.bg)
    this.backdrop = this.add.graphics().setDepth(-2)
    this.logo = createSnakeLogo(this, menuSkin.palette)
    const initial = computeMenuLayout(viewport, this.logo.height, this.touch, this.showInstallHint)

    this.bestStar = this.add.graphics()
    this.bestLabel = this.add
      .text(
        0,
        0,
        services.i18n.t('menu.best', { score: save.best }),
        textStyle(theme, 26, cssColor(snakeColors.art.ui.onBg), true),
      )
      .setOrigin(0.5)

    this.playGlow = this.add.graphics()
    this.playWidth = initial.playWidth
    this.playButton = new Button(this, 0, 0, services.i18n.t('menu.play'), theme, {
      width: initial.playWidth,
      height: MENU_PLAY_HEIGHT,
      fontSize: PLAY_FONT_SIZE,
      icon: 'play',
      decoration: fruitDecoration,
      onClick: () => this.startRun(),
    })

    this.collectionButton = new Button(this, 0, 0, '', theme, {
      width: initial.settings.size,
      height: initial.settings.size,
      variant: 'soft',
      minHitSize: this.touch ? MENU_SETTINGS_HIT : undefined,
      fontSize: SETTINGS_ICON_SIZE,
      icon: 'bag',
      onClick: () => this.openCollection(),
    })

    this.settingsButton = new Button(this, 0, 0, '', theme, {
      width: initial.settings.size,
      height: initial.settings.size,
      variant: 'soft',
      minHitSize: this.touch ? MENU_SETTINGS_HIT : undefined,
      fontSize: SETTINGS_ICON_SIZE,
      decoration: gearDecoration,
      onClick: () => this.openSettings(),
    })

    this.languageButton = new Button(this, 0, 0, LANG_SHORT[services.i18n.lang], theme, {
      width: initial.settings.size,
      height: initial.settings.size,
      variant: 'soft',
      minHitSize: this.touch ? MENU_SETTINGS_HIT : undefined,
      fontSize: SETTINGS_LABEL_SIZE,
      onClick: () => this.openLanguage(),
    })

    this.demo = createMenuDemo(this, startingSegmentColors(menuSkin.palette))
    this.controlsIcon = this.add.graphics()
    this.drawControlHint()

    this.hintKey = this.touch
      ? initial.demo.visible
        ? 'menu.controlsTouchTry'
        : 'menu.controlsTouch'
      : 'menu.controlsDesktop'
    this.hint = this.add
      .text(
        0,
        0,
        services.i18n.t(this.hintKey),
        textStyle(theme, 28, cssColor(snakeColors.art.ui.onBgMuted)),
      )
      .setOrigin(0.5)

    this.coach = new DemoCoach(this, theme, this.demo, this.touch ? 'touch' : 'keys')
    this.steer = new SwipeSteer(this, theme, (direction) => this.handleDemoSteer(direction))

    if (this.showInstallHint) {
      this.installHint = this.add
        .text(0, 0, services.i18n.t('menu.fullscreenHint'), {
          ...textStyle(theme, 24, cssColor(snakeColors.art.ui.onBgMuted)),
          align: 'center',
        })
        .setOrigin(0.5)
    }

    this.applyLayout(viewport, initial)
    onLayoutChange(this, (next) => {
      this.languageModal?.close()
      this.collectionModal?.close()
      this.settingsModal?.close()
      this.applyLayout(
        next,
        computeMenuLayout(next, this.logo.height, this.touch, this.showInstallHint),
      )
    })
    this.playEntrance()

    this.input.keyboard?.on('keydown-ENTER', () => this.startRun())
    this.input.keyboard?.on('keydown-SPACE', () => this.startRun())
    const takeoverKeys: readonly (readonly [string, Direction])[] = [
      ['UP', 'up'],
      ['W', 'up'],
      ['DOWN', 'down'],
      ['S', 'down'],
      ['LEFT', 'left'],
      ['A', 'left'],
      ['RIGHT', 'right'],
      ['D', 'right'],
    ]
    for (const [key, direction] of takeoverKeys) {
      this.input.keyboard?.on(`keydown-${key}`, (event: KeyboardEvent) => {
        event.preventDefault()
        this.handleDemoSteer(direction)
      })
    }
  }

  private startRun(): void {
    if (this.modalOpen()) return
    this.coach.cancel()
    this.steer.setEnabled(false)
    const services = getServices()
    maybeEnterFullscreen(this.scale)
    services.audio.unlock()
    playSfx('click')
    this.scene.start('Game')
  }

  private modalOpen(): boolean {
    return Boolean(this.languageModal || this.collectionModal || this.settingsModal)
  }

  private openLanguage(): void {
    if (this.modalOpen()) return
    const services = getServices()
    playSfx('click')
    this.steer.setEnabled(false)
    this.coach.pause()
    this.languageModal = new LanguageModal(this, {
      theme: services.theme,
      current: services.i18n.lang,
      title: services.i18n.t('core.language'),
      onSelect: (lang) => {
        services.setLang(lang)
        this.scene.restart()
      },
      onClose: () => {
        this.languageModal = undefined
        this.coach.resume()
        this.syncDemoSteer(this.layout)
        this.syncHint(this.layout)
      },
    })
  }

  private openSettings(): void {
    if (this.modalOpen()) return
    const services = getServices()
    playSfx('click')
    this.steer.setEnabled(false)
    this.coach.pause()
    this.settingsModal = new SettingsModal(this, {
      theme: services.theme,
      settings: snakeSave(services).read().settings,
      onSettingsChange: (settings) => {
        snakeSave(services).update((save) => ({ ...save, settings }))
      },
      onClose: () => {
        this.settingsModal = undefined
        this.coach.resume()
        this.syncDemoSteer(this.layout)
        this.syncHint(this.layout)
      },
    })
  }

  private openCollection(): void {
    if (this.modalOpen()) return
    const services = getServices()
    playSfx('click')
    this.steer.setEnabled(false)
    this.coach.pause()
    this.collectionModal = new CollectionModal(this, {
      theme: services.theme,
      title: services.i18n.t('collection.title'),
      fruitsLabel: services.i18n.t('collection.fruits'),
      itemsLabel: services.i18n.t('collection.items'),
      onClose: () => {
        this.collectionModal = undefined
        this.coach.resume()
        this.syncDemoSteer(this.layout)
        this.syncHint(this.layout)
      },
    })
  }

  private applyLayout(viewport: Viewport, layout: MenuLayout): void {
    const theme = getServices().theme
    this.layout = layout
    const quiet = this.sceneryQuiet(layout)
    const plan = drawBackdrop(this.backdrop, viewport, theme, { quiet, density: 'menu' })
    this.ambience?.destroy()
    this.ambience = new OrchardAmbience(this, theme, plan, 'menu').setDepth(-1)

    const logoScale = Math.min(1, layout.logoMaxWidth / this.logo.width)
    this.logo.container.setPosition(layout.centerX, layout.logoY).setScale(logoScale)

    this.drawBest(layout)

    this.playButton.setPosition(layout.centerX, layout.playY)
    this.drawPlayGlow(layout)
    this.collectionButton.setPosition(layout.settings.collection.x, layout.settings.collection.y)
    this.settingsButton.setPosition(layout.settings.settings.x, layout.settings.settings.y)
    this.languageButton.setPosition(layout.settings.language.x, layout.settings.language.y)

    this.installHint?.setPosition(layout.centerX, layout.installHintY)
    this.installHint?.setWordWrapWidth(
      viewport.width - viewport.insets.left - viewport.insets.right - 48,
    )

    this.demo.container
      .setPosition(layout.demo.x, layout.demo.y)
      .setScale(layout.demo.scale)
      .setAngle(layout.demo.angle)
      .setVisible(layout.demo.visible)

    if (layout.demo.visible) {
      this.coach.resume()
    } else {
      this.coach.pause()
    }
    this.syncDemoSteer(layout)
    this.syncHint(layout)
  }

  /**
   * Rectangles the orchard must leave alone. The plan adds its own padding, so
   * this only describes the real UI bounds.
   */
  private sceneryQuiet(layout: MenuLayout): SceneryRect[] {
    const logoScale = Math.min(1, layout.logoMaxWidth / this.logo.width)
    const logoWidth = this.logo.width * logoScale
    const logoHeight = this.logo.height * logoScale
    const settingsSize = layout.settings.size
    const settingsLeft = layout.settings.collection.x - settingsSize / 2
    const settingsRight = layout.settings.language.x + settingsSize / 2

    const rects: SceneryRect[] = [
      {
        x: layout.centerX - logoWidth / 2,
        y: layout.logoY - logoHeight / 2,
        width: logoWidth,
        height: logoHeight,
      },
      {
        x: layout.centerX - this.bestLabel.width / 2,
        y: layout.bestY - 20,
        width: this.bestLabel.width,
        height: 40,
      },
      {
        x: layout.centerX - this.playWidth / 2 - 10,
        y: layout.playY - MENU_PLAY_HEIGHT / 2 - 10,
        width: this.playWidth + 20,
        height: MENU_PLAY_HEIGHT + 20,
      },
      {
        x: layout.centerX - this.hint.width / 2,
        y: layout.hintY - 20,
        width: this.hint.width,
        height: 40,
      },
      {
        x: settingsLeft,
        y: layout.settings.collection.y - settingsSize / 2,
        width: settingsRight - settingsLeft,
        height: settingsSize,
      },
    ]

    if (layout.demo.visible) {
      rects.push({
        x: layout.demo.x - layout.demo.width / 2,
        y: layout.demo.y - layout.demo.height / 2,
        width: layout.demo.width,
        height: layout.demo.height,
      })
    }
    if (this.installHint) {
      rects.push({
        x: layout.centerX - this.installHint.width / 2,
        y: layout.installHintY - 30,
        width: this.installHint.width,
        height: 60,
      })
    }

    return rects
  }

  private syncDemoSteer(layout: MenuLayout): void {
    const enabled = layout.demo.visible && !this.modalOpen()
    this.steer.setEnabled(enabled)
    this.steer.setActiveRect(enabled ? menuDemoTouchRect(layout.demo) : null)
  }

  private syncHint(layout: MenuLayout): void {
    const key: HintKey = this.touch
      ? layout.demo.visible
        ? 'menu.controlsTouchTry'
        : 'menu.controlsTouch'
      : 'menu.controlsDesktop'
    if (key !== this.hintKey) {
      this.hintKey = key
      this.hint.setText(getServices().i18n.t(key))
    }

    const gap = 14
    const total = this.controlIconWidth + gap + this.hint.width
    const left = layout.centerX - total / 2
    this.controlsIcon.setPosition(left + this.controlIconWidth / 2, layout.hintY)
    this.hint.setPosition(left + this.controlIconWidth + gap + this.hint.width / 2, layout.hintY)
  }

  private handleDemoSteer(direction: Direction): void {
    if (this.modalOpen() || !this.layout.demo.visible) return
    if (this.demo.steer(direction)) {
      this.coach.cancel()
    }
  }

  private drawPlayGlow(layout: MenuLayout): void {
    const theme = getServices().theme
    const width = this.playWidth + PLAY_GLOW_PADDING * 2
    const height = MENU_PLAY_HEIGHT + PLAY_GLOW_PADDING * 2
    const radius = Math.min(theme.radius + PLAY_GLOW_PADDING, height / 2)
    const glow = this.playGlow
    glow.clear()
    glow.setPosition(layout.centerX, layout.playY)
    glow.fillStyle(theme.accent, 0.1)
    glow.fillRoundedRect(
      -width / 2 - PLAY_GLOW_PADDING / 2,
      -height / 2 - PLAY_GLOW_PADDING / 2,
      width + PLAY_GLOW_PADDING,
      height + PLAY_GLOW_PADDING,
      radius + PLAY_GLOW_PADDING / 2,
    )
    glow.fillStyle(theme.accent, 0.16)
    glow.fillRoundedRect(-width / 2, -height / 2, width, height, radius)
  }

  private drawBest(layout: MenuLayout): void {
    const theme = getServices().theme
    const gap = 10
    const total = BEST_BADGE + gap + this.bestLabel.width
    const left = layout.centerX - total / 2

    this.bestStar.clear()
    this.bestStar.setPosition(left + BEST_BADGE / 2, layout.bestY)
    this.bestStar.fillStyle(theme.accent, 1)
    this.bestStar.fillCircle(0, 0, BEST_BADGE / 2)
    this.bestStar.lineStyle(2, theme.onAccent, 1)
    this.bestStar.strokeCircle(0, 0, BEST_BADGE / 2 - 1)
    drawIcon(this.bestStar, 'star', 20, theme.onAccent, false)

    this.bestLabel.setPosition(left + BEST_BADGE + gap + this.bestLabel.width / 2, layout.bestY)
  }

  private drawControlHint(): void {
    const theme = getServices().theme
    const graphics = this.controlsIcon
    graphics.clear()

    if (this.touch) {
      // A fingertip with motion lines reads as "swipe" instead of "hold".
      graphics.lineStyle(3, snakeColors.art.ui.onBgMuted, 0.35)
      graphics.lineBetween(-26, -8, -13, -8)
      graphics.lineStyle(3, snakeColors.art.ui.onBgMuted, 0.5)
      graphics.lineBetween(-24, 1, -13, 1)
      graphics.lineStyle(3, snakeColors.art.ui.onBgMuted, 0.65)
      graphics.lineBetween(-26, 10, -13, 10)

      graphics.fillStyle(snakeColors.art.ui.onBg, 1)
      graphics.fillRoundedRect(-8, 12, 26, 14, 7)
      graphics.fillRoundedRect(-3, 2, 10, 20, 5)
      graphics.fillCircle(2, 0, 11)
      graphics.fillStyle(theme.highlight, 0.5)
      graphics.fillCircle(-1, -3, 3.5)
      return
    }

    const size = 34
    const gap = 8
    const start = -(4 * size + 3 * gap) / 2 + size / 2
    const arrows = ['up', 'down', 'left', 'right'] as const
    arrows.forEach((arrow, index) => {
      const x = start + index * (size + gap)
      graphics.fillStyle(theme.surface, 0.9)
      graphics.fillRoundedRect(x - size / 2, -size / 2, size, size, 8)
      graphics.lineStyle(1, theme.borderSoft, 1)
      graphics.strokeRoundedRect(x - size / 2, -size / 2, size, size, 8)
      graphics.fillStyle(theme.ink, 0.78)
      if (arrow === 'up') graphics.fillTriangle(x, -8, x - 7, 5, x + 7, 5)
      if (arrow === 'down') graphics.fillTriangle(x, 8, x - 7, -5, x + 7, -5)
      if (arrow === 'left') graphics.fillTriangle(x - 8, 0, x + 5, -7, x + 5, 7)
      if (arrow === 'right') graphics.fillTriangle(x + 8, 0, x - 5, -7, x - 5, 7)
    })
  }

  private playEntrance(): void {
    this.logo.playEntrance()

    this.bestStar.setAlpha(0)
    this.bestLabel.setAlpha(0)
    this.playGlow.setAlpha(0).setScale(1)
    this.playButton.setAlpha(0).setScale(0.9)
    this.collectionButton.setAlpha(0)
    this.settingsButton.setAlpha(0)
    this.languageButton.setAlpha(0)
    this.controlsIcon.setAlpha(0)
    this.hint.setAlpha(0)
    this.demo.container.setAlpha(0)
    this.installHint?.setAlpha(0)

    this.tweens.add({
      targets: [this.bestStar, this.bestLabel],
      alpha: 1,
      duration: 340,
      delay: 220,
    })
    this.tweens.add({
      targets: [this.collectionButton, this.settingsButton, this.languageButton],
      alpha: 1,
      duration: 260,
      delay: 60,
      ease: 'Quad.out',
    })
    this.tweens.add({
      targets: this.playButton,
      alpha: 1,
      scale: 1,
      duration: 380,
      delay: 180,
      ease: 'Back.out',
    })
    this.tweens.add({
      targets: this.playGlow,
      alpha: 1,
      duration: 360,
      delay: 220,
      onComplete: () => this.startPlayGlowPulse(),
    })
    this.tweens.add({
      targets: [this.controlsIcon, this.hint],
      alpha: 1,
      duration: 340,
      delay: 320,
    })
    this.tweens.add({
      targets: this.demo.container,
      alpha: 1,
      duration: 420,
      delay: 380,
      onComplete: () => this.coach.start(),
    })
    if (this.installHint) {
      this.tweens.add({ targets: this.installHint, alpha: 1, duration: 340, delay: 460 })
    }
  }

  /** A slow breathing halo keeps the CTA alive without moving its hit area. */
  private startPlayGlowPulse(): void {
    this.tweens.add({
      targets: this.playGlow,
      alpha: 0.55,
      scale: 1.025,
      duration: 1700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    })
  }

  private shouldShowInstallHint(): boolean {
    if (isEmbedded()) return false
    if (this.scale.fullscreen.available) return false
    if (isStandalone()) return false
    return this.touch
  }
}
