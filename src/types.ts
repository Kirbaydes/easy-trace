/*
 * Easy Trace — trace images into editable vector silhouettes inside Figma.
 * Copyright (C) 2026 Kirill Baydakov
 *
 * Free software under the GNU General Public License, version 2 or later.
 * Bundles Potrace, Copyright (C) Peter Selinger, which is GPL-licensed —
 * see LICENSE and NOTICE in the project root.
 */

export type Lang = 'en' | 'ru'

export interface Options {
  /** Порог яркости: всё темнее него уходит в силуэт, 10…245. */
  threshold: number
  /** Оставить силуэт на прозрачном фоне вместо белой подложки. */
  removeBg: boolean
  /** Обменять местами фигуру и фон — для светлого рисунка на тёмном. */
  invert: boolean
  lang: Lang
}

export interface SourceInfo {
  id: string
  name: string
  /** Размеры слоя на холсте. */
  width: number
  height: number
}

/** Почему нечего трассировать. */
export type EmptyReason = 'nothing' | 'no-image'

/** UI → main */
export type UiMessage =
  | { type: 'ui-ready' }
  | { type: 'insert'; sourceId: string; svg: string; paths: number }
  | { type: 'save-options'; options: Options }
  | { type: 'set-lang'; lang: Lang }
  | { type: 'select-node'; id: string }

/** main → UI */
export type PluginMessage =
  | { type: 'options'; options: Partial<Options> | null }
  | { type: 'selection'; source: SourceInfo | null; reason: EmptyReason; extra: number }
  | { type: 'image'; id: string; bytes: Uint8Array }
  | { type: 'inserted'; name: string }
  | { type: 'log'; text: string }
  | { type: 'error'; message: string }
