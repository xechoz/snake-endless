import type { Theme } from '@mg/core'
import type Phaser from 'phaser'
import { snakeColors } from '../colors'
import type { Cell, FruitKind } from '../logic/types'
import type { BoardMetrics } from './gameArt'

const TAU = Math.PI * 2

export function drawGardenBoard(
  graphics: Phaser.GameObjects.Graphics,
  board: BoardMetrics,
  columns: number,
  rows: number,
  blocked: readonly Cell[],
  theme: Theme,
): void {
  const garden = snakeColors.art.garden
  const { x, y, width, cell } = board
  const radius = 28

  graphics.clear()

  graphics.fillStyle(theme.shadow, 0.24)
  graphics.fillRoundedRect(x - 18, y - 10, width + 36, width + 42, radius + 8)
  graphics.fillStyle(garden.frameDark, 1)
  graphics.fillRoundedRect(x - 16, y - 16, width + 32, width + 32, radius)
  graphics.fillStyle(garden.frame, 1)
  graphics.fillRoundedRect(x - 12, y - 12, width + 24, width + 24, radius - 4)
  graphics.fillStyle(garden.frameLight, 0.5)
  graphics.fillRoundedRect(x - 9, y - 9, width + 18, width + 18, radius - 7)

  // A clipped hedge ring separates the wooden rim from the soil, so the bed
  // reads as a garden even when the board is full of dark tiles.
  graphics.fillStyle(garden.hedge, 1)
  graphics.fillRoundedRect(x - 6, y - 6, width + 12, width + 12, radius - 4)

  graphics.fillStyle(garden.soil, 1)
  graphics.fillRect(x, y, width, width)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const px = x + column * cell
      const py = y + row * cell
      const even = (column + row) % 2 === 0
      graphics.fillStyle(even ? garden.soil : garden.soilAlt, 1)
      graphics.fillRect(px, py, cell + 0.5, cell + 0.5)

      if ((column * 7 + row * 13) % 5 === 0) {
        graphics.fillStyle(garden.soilEdge, 0.22)
        graphics.fillCircle(px + cell * 0.24, py + cell * 0.68, Math.max(1, cell * 0.035))
        graphics.fillCircle(px + cell * 0.68, py + cell * 0.34, Math.max(1, cell * 0.025))
      }
    }
  }

  graphics.lineStyle(1, garden.soilEdge, 0.16)
  for (let column = 1; column < columns; column += 1) {
    graphics.lineBetween(x + column * cell, y, x + column * cell, y + width)
  }
  for (let row = 1; row < rows; row += 1) {
    graphics.lineBetween(x, y + row * cell, x + width, y + row * cell)
  }

  for (const blockedCell of blocked) {
    drawHedge(graphics, x + blockedCell.x * cell, y + blockedCell.y * cell, cell, garden)
  }

  graphics.lineStyle(3, garden.soilEdge, 0.45)
  graphics.strokeRect(x + 1.5, y + 1.5, width - 3, width - 3)

  // A few flowers on the wooden rim make the frame feel like a garden bed.
  const rim = 10
  const corners = [
    { x: x - rim, y: y - rim },
    { x: x + width + rim, y: y - rim },
    { x: x - rim, y: y + width + rim },
    { x: x + width + rim, y: y + width + rim },
  ]
  for (const [index, corner] of corners.entries()) {
    drawFlower(
      graphics,
      corner.x,
      corner.y,
      9,
      snakeColors.art.confetti[index % 5] ?? garden.petal,
      0,
      theme,
    )
  }
}

export function drawPaintTrail(
  graphics: Phaser.GameObjects.Graphics,
  board: BoardMetrics,
  painted: ReadonlyMap<number, FruitKind | null>,
  columns: number,
  theme: Theme,
): void {
  graphics.clear()
  const cell = board.cell
  for (const [key, kind] of painted) {
    const column = key % columns
    const row = Math.floor(key / columns)
    const x = board.x + column * cell
    const y = board.y + row * cell
    const color = kind ? snakeColors.art.fruits[kind].body : snakeColors.art.snakeHead
    graphics.fillStyle(color, 0.38)
    graphics.fillRoundedRect(x + 2, y + 2, cell - 4, cell - 4, Math.max(3, cell * 0.16))
    graphics.fillStyle(color, 0.22)
    graphics.fillCircle(x + cell / 2, y + cell / 2, cell * 0.2)
  }
  // The caller draws the board under this layer; keep a soft rim so the trail
  // never looks like it is leaking past the wooden frame.
  graphics.lineStyle(2, theme.shadow, 0.08)
  graphics.strokeRect(board.x, board.y, board.width, board.width)
}

export function drawFlower(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  time: number,
  theme: Theme,
): void {
  const sway = Math.sin(time * 0.004) * 0.16
  const petals = 5
  graphics.fillStyle(theme.ink, 0.85)
  for (let index = 0; index < petals; index += 1) {
    const angle = (TAU * index) / petals - Math.PI / 2 + sway
    const px = x + Math.cos(angle) * radius * 0.62
    const py = y + Math.sin(angle) * radius * 0.62
    graphics.fillCircle(px, py, radius * 0.52)
  }
  graphics.fillStyle(color, 1)
  for (let index = 0; index < petals; index += 1) {
    const angle = (TAU * index) / petals - Math.PI / 2 + sway
    const px = x + Math.cos(angle) * radius * 0.62
    const py = y + Math.sin(angle) * radius * 0.62
    graphics.fillCircle(px, py, radius * 0.42)
  }
  graphics.fillStyle(theme.accentWarm, 1)
  graphics.fillCircle(x, y, radius * 0.36)
  graphics.fillStyle(theme.ink, 0.5)
  graphics.fillCircle(x - radius * 0.08, y - radius * 0.1, radius * 0.055)
}

function drawHedge(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  size: number,
  garden: typeof snakeColors.art.garden,
): void {
  const inset = Math.max(1.5, size * 0.06)
  const radius = size * 0.24
  graphics.fillStyle(snakeColors.art.ink, 0.35)
  graphics.fillRoundedRect(x + inset, y + inset + 2, size - inset * 2, size - inset * 2, radius)
  graphics.fillStyle(garden.hedge, 1)
  graphics.fillRoundedRect(x + inset, y + inset, size - inset * 2, size - inset * 2, radius)

  for (let index = 0; index < 3; index += 1) {
    const bx = x + size * (0.28 + index * 0.22)
    const by = y + size * (0.34 + (index % 2) * 0.08)
    graphics.fillStyle(garden.hedgeLight, 1)
    graphics.fillCircle(bx, by, size * 0.12)
    graphics.fillStyle(garden.hedge, 1)
    graphics.fillCircle(bx + size * 0.06, by + size * 0.06, size * 0.07)
  }
}
