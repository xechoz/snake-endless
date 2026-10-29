import { createGame } from '@mg/core'
import { snakeColors } from './colors'
import { snakeI18n } from './i18n'
import { GameScene } from './scenes/GameScene'
import { HudScene } from './scenes/HudScene'
import { MenuScene } from './scenes/MenuScene'

const eatSamples = [
  new URL('./assets/audio/eat-1.wav', import.meta.url).href,
  new URL('./assets/audio/eat-2.wav', import.meta.url).href,
]
const music = new URL('./assets/audio/sweet-fun-loop.mp3', import.meta.url).href
const handPointer = new URL('./assets/hand-pointer.svg', import.meta.url).href

createGame({
  id: 'snake-endless',
  design: { base: 720 },
  theme: snakeColors.theme,
  defaultLang: 'en',
  i18n: snakeI18n,
  menuScene: 'Menu',
  assets: {
    images: [{ key: 'hand-pointer', url: handPointer }],
    audio: [{ key: 'music', urls: music }],
  },
  audioSamples: { eat: eatSamples },
  scenes: [MenuScene, GameScene, HudScene],
})
