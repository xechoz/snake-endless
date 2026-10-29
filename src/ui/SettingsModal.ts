import { Button, getServices, readViewport, type Theme, textStyle } from '@mg/core'
import Phaser from 'phaser'
import { setMusicVolume, syncMusic } from '../audio/music'
import { playSfx } from '../audio/sfx'
import type { SnakeSettings } from '../save'

export interface SettingsModalOptions {
  theme: Theme
  settings: SnakeSettings
  onSettingsChange: (settings: SnakeSettings) => void
  onClose?: () => void
}

const CARD_WIDTH = 640
const CARD_HEIGHT = 380
const ROW_WIDTH = CARD_WIDTH - 88
const TITLE_SIZE = 34
const LABEL_SIZE = 27
const VALUE_SIZE = 25

/**
 * Player preferences that belong to the game rather than the host portal:
 * music and effect levels, and the master mute. The
 * modal is deliberately a single column so it fits landscape and portrait
 * without a second scroll state.
 */
export class SettingsModal extends Phaser.GameObjects.Container {
  private closed = false
  private settings: SnakeSettings
  private readonly theme: Theme
  private readonly options: SettingsModalOptions
  private readonly card: Phaser.GameObjects.Container
  private soundButton!: Button

  constructor(scene: Phaser.Scene, options: SettingsModalOptions) {
    super(scene, 0, 0)
    scene.add.existing(this).setDepth(2000)
    this.options = options
    this.theme = options.theme
    this.settings = options.settings

    const viewport = readViewport(scene)
    const width = Math.min(viewport.width - 40, CARD_WIDTH)
    const height = Math.min(viewport.height - 40, CARD_HEIGHT)

    const backdrop = scene.add
      .rectangle(0, 0, viewport.width, viewport.height, options.theme.overlay, 0.72)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true })
    backdrop.on('pointerdown', () => this.close())
    this.add(backdrop)

    this.card = scene.add.container(viewport.width / 2, viewport.height / 2)
    this.add(this.card)

    const shield = scene.add.rectangle(0, 0, width, height, 0, 0).setInteractive()
    this.card.add(shield)

    const panel = scene.add.graphics()
    panel.fillStyle(options.theme.shadow, 0.18)
    panel.fillRoundedRect(
      -width / 2 + 2,
      -height / 2 + 10,
      width,
      height,
      options.theme.radiusLarge,
    )
    panel.fillStyle(options.theme.panel, 1)
    panel.fillRoundedRect(-width / 2, -height / 2, width, height, options.theme.radiusLarge)
    panel.lineStyle(2, options.theme.borderSoft, 1)
    panel.strokeRoundedRect(-width / 2, -height / 2, width, height, options.theme.radiusLarge)
    this.card.add(panel)

    const title = scene.add
      .text(
        0,
        -height / 2 + 46,
        getServices().i18n.t('settings.title'),
        textStyle(options.theme, TITLE_SIZE, options.theme.text, true),
      )
      .setOrigin(0.5)
    this.card.add(title)

    const close = new Button(scene, width / 2 - 36, -height / 2 + 40, '×', options.theme, {
      width: 44,
      height: 44,
      variant: 'soft',
      fontSize: 30,
      minHitSize: 48,
      onClick: () => this.close(),
    })
    this.card.add(close)

    const top = -height / 2
    this.buildSoundButton(top + 112, width)
    this.buildVolumeRow(top + 190, 'settings.music', this.settings.musicVolume, {
      onPreview: (value) => setMusicVolume(value),
      onCommit: (value) => {
        this.persist({ ...this.settings, musicVolume: value })
        setMusicVolume(value)
      },
    })
    this.buildVolumeRow(top + 274, 'settings.effects', this.settings.sfxVolume, {
      onPreview: () => undefined,
      onCommit: (value) => {
        this.persist({ ...this.settings, sfxVolume: value })
        playSfx('click')
      },
    })

    const onEsc = (): void => this.close()
    scene.input.keyboard?.on('keydown-ESC', onEsc)
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.keyboard?.off('keydown-ESC', onEsc)
      options.onClose?.()
    })

    this.setAlpha(0)
    this.card.setScale(0.96)
    scene.tweens.add({ targets: this, alpha: 1, duration: 150 })
    scene.tweens.add({ targets: this.card, scale: 1, duration: 190, ease: 'Back.Out' })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    // A drag that never saw pointerup should not leave the track at an
    // uncommitted level.
    setMusicVolume(this.settings.musicVolume)
    this.destroy(true)
  }

  private buildSoundButton(y: number, cardWidth: number): void {
    const services = getServices()
    const on = services.settings.value.sound
    this.soundButton = new Button(
      this.scene,
      0,
      y,
      services.i18n.t(on ? 'core.soundOn' : 'core.soundOff'),
      this.theme,
      {
        width: cardWidth - 88,
        height: 58,
        variant: 'soft',
        fontSize: 26,
        icon: on ? 'soundOn' : 'soundOff',
        onClick: () => {
          const next = !services.settings.value.sound
          services.setSound(next)
          syncMusic()
          this.soundButton
            .setText(services.i18n.t(next ? 'core.soundOn' : 'core.soundOff'))
            .setIcon(next ? 'soundOn' : 'soundOff')
          playSfx('click')
        },
      },
    )
    this.card.add(this.soundButton)
  }

  private buildVolumeRow(
    y: number,
    labelKey: 'settings.music' | 'settings.effects',
    value: number,
    handlers: { onPreview: (value: number) => void; onCommit: (value: number) => void },
  ): void {
    const row = new VolumeRow(this.scene, this.theme, {
      width: ROW_WIDTH,
      label: getServices().i18n.t(labelKey),
      value,
      onPreview: handlers.onPreview,
      onCommit: handlers.onCommit,
    })
    row.setPosition(0, y)
    this.card.add(row)
  }

  private persist(next: SnakeSettings): void {
    this.settings = next
    this.options.onSettingsChange(next)
  }
}

interface VolumeRowOptions {
  readonly width: number
  readonly label: string
  readonly value: number
  readonly onPreview: (value: number) => void
  readonly onCommit: (value: number) => void
}

/** Label, percentage and a draggable track in one row. */
class VolumeRow extends Phaser.GameObjects.Container {
  private readonly trackWidth: number
  private readonly fill: Phaser.GameObjects.Graphics
  private readonly knob: Phaser.GameObjects.Graphics
  private readonly percent: Phaser.GameObjects.Text
  private readonly options: VolumeRowOptions
  private readonly theme: Theme
  private value: number
  private dragging = false

  constructor(scene: Phaser.Scene, theme: Theme, options: VolumeRowOptions) {
    super(scene, 0, 0)
    this.options = options
    this.theme = theme
    this.value = options.value
    this.trackWidth = options.width

    const label = scene.add
      .text(-options.width / 2, -24, options.label, textStyle(theme, LABEL_SIZE, theme.text, true))
      .setOrigin(0, 0.5)
    this.percent = scene.add
      .text(
        options.width / 2,
        -24,
        `${Math.round(options.value * 100)}%`,
        textStyle(theme, VALUE_SIZE, theme.textMuted, true),
      )
      .setOrigin(1, 0.5)
    this.fill = scene.add.graphics()
    this.knob = scene.add.graphics()
    const zone = scene.add.zone(0, 14, options.width + 32, 44).setInteractive({
      useHandCursor: true,
    })

    this.add([label, this.percent, this.fill, this.knob, zone])
    this.redraw()

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragging = true
      this.setFromPointer(pointer)
    })
    scene.input.on('pointermove', this.handleMove, this)
    scene.input.on('pointerup', this.handleUp, this)
  }

  override destroy(fromScene?: boolean): void {
    this.scene?.input.off('pointermove', this.handleMove, this)
    this.scene?.input.off('pointerup', this.handleUp, this)
    super.destroy(fromScene)
  }

  private handleMove(pointer: Phaser.Input.Pointer): void {
    if (this.dragging) this.setFromPointer(pointer)
  }

  private handleUp(): void {
    if (!this.dragging) return
    this.dragging = false
    this.options.onCommit(this.value)
  }

  private setFromPointer(pointer: Phaser.Input.Pointer): void {
    const local = this.getWorldTransformMatrix().applyInverse(pointer.worldX, pointer.worldY)
    const value = clamp((local.x + this.trackWidth / 2) / this.trackWidth)
    this.value = Math.round(value * 20) / 20
    this.redraw()
    this.options.onPreview(this.value)
  }

  private redraw(): void {
    const left = -this.trackWidth / 2
    const knobX = left + this.trackWidth * this.value
    this.percent.setText(`${Math.round(this.value * 100)}%`)

    this.fill.clear()
    this.fill.fillStyle(this.theme.borderSoft, 0.45)
    this.fill.fillRoundedRect(left, 7, this.trackWidth, 10, 5)
    if (this.value > 0) {
      this.fill.fillStyle(this.theme.accent, 1)
      this.fill.fillRoundedRect(left, 7, Math.max(10, this.trackWidth * this.value), 10, 5)
    }

    this.knob.clear()
    this.knob.fillStyle(this.theme.shadow, 0.18)
    this.knob.fillCircle(knobX, 14, 15)
    this.knob.fillStyle(this.theme.surface, 1)
    this.knob.fillCircle(knobX, 12, 14)
    this.knob.lineStyle(3, this.theme.accent, 1)
    this.knob.strokeCircle(knobX, 12, 11)
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
