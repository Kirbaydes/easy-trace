/*
 * Easy Trace — trace images into editable vector silhouettes inside Figma.
 * Copyright (C) 2026 Kirill Baydakov
 *
 * Free software under the GNU General Public License, version 2 or later.
 * Bundles Potrace, Copyright (C) Peter Selinger, which is GPL-licensed —
 * see LICENSE and NOTICE in the project root.
 */

import type { EmptyReason, Lang, Options, PluginMessage, SourceInfo, UiMessage } from './types'

const OPTIONS_KEY = 'easy-trace.options'
/** Отступ между оригиналом и результатом, в пикселях холста. */
const GAP = 40

const STRINGS = {
  en: {
    selected: (name: string, w: number, h: number) => `selected “${name}”, ${w} × ${h}`,
    imageSent: (kb: string) => `source image: ${kb} KB`,
    inserting: (paths: number) => `inserting ${paths} paths…`,
    inserted: (name: string, ms: number) => `“${name}” added in ${ms} ms`,
    optionsNotSaved: (text: string) => `settings were not saved: ${text}`,
    optionsNotRead: (text: string) => `settings were not read: ${text}`,
    handlerFailed: (type: string, text: string) => `handler failed (${type}): ${text}`,
    gone: 'The source layer is no longer on the canvas.',
    noImage: 'That layer has no image fill.',
    emptySvg: 'Nothing to insert — the trace produced no paths.',
  },
  ru: {
    selected: (name: string, w: number, h: number) => `выбран «${name}», ${w} × ${h}`,
    imageSent: (kb: string) => `исходная картинка: ${kb} КБ`,
    inserting: (paths: number) => `вставляю ${paths} путей…`,
    inserted: (name: string, ms: number) => `«${name}» добавлен за ${ms} мс`,
    optionsNotSaved: (text: string) => `настройки не сохранились: ${text}`,
    optionsNotRead: (text: string) => `настройки не прочитались: ${text}`,
    handlerFailed: (type: string, text: string) => `сбой обработчика (${type}): ${text}`,
    gone: 'Исходный слой больше не найден на холсте.',
    noImage: 'У этого слоя нет заливки картинкой.',
    emptySvg: 'Вставлять нечего — трассировка не дала ни одного пути.',
  },
}

let lang: Lang = 'en'
const s = () => STRINGS[lang]

figma.showUI(__html__, { width: 400, height: 680, title: 'Easy Trace' })

function post(message: PluginMessage) {
  figma.ui.postMessage(message)
}

function log(text: string) {
  post({ type: 'log', text })
}

function describe(error: unknown) {
  return error instanceof Error ? error.message || error.name : String(error)
}

/** Верхняя видимая заливка-картинка узла, если она есть. */
function imagePaintOf(node: SceneNode): ImagePaint | null {
  if (!('fills' in node)) return null
  const fills = (node as GeometryMixin).fills
  if (fills === figma.mixed || !Array.isArray(fills)) return null
  for (let i = fills.length - 1; i >= 0; i--) {
    const paint = fills[i]
    if (paint.type === 'IMAGE' && paint.visible !== false && paint.imageHash) return paint
  }
  return null
}

interface Source {
  node: SceneNode
  paint: ImagePaint
}

function findSource(): { source: Source | null; reason: EmptyReason; extra: number } {
  const selection = figma.currentPage.selection
  if (selection.length === 0) return { source: null, reason: 'nothing', extra: 0 }

  const matches: Source[] = []
  for (const node of selection) {
    const paint = imagePaintOf(node)
    if (paint) matches.push({ node, paint })
  }
  if (matches.length === 0) return { source: null, reason: 'no-image', extra: 0 }
  return { source: matches[0], reason: 'nothing', extra: matches.length - 1 }
}

let sendToken = 0

async function pushSelection() {
  const { source, reason, extra } = findSource()
  const token = ++sendToken

  if (!source) {
    post({ type: 'selection', source: null, reason, extra: 0 })
    return
  }

  const box = source.node.absoluteBoundingBox
  const info: SourceInfo = {
    id: source.node.id,
    name: source.node.name,
    width: Math.round(box ? box.width : source.node.width),
    height: Math.round(box ? box.height : source.node.height),
  }
  post({ type: 'selection', source: info, reason, extra })
  log(s().selected(info.name, info.width, info.height))

  const image = figma.getImageByHash(source.paint.imageHash as string)
  if (!image) {
    post({ type: 'error', message: s().noImage })
    return
  }
  const bytes = await image.getBytesAsync()
  if (token !== sendToken) return
  log(s().imageSent((bytes.length / 1024).toFixed(0)))
  post({ type: 'image', id: info.id, bytes })
}

async function insertVectors(sourceId: string, svg: string, paths: number) {
  const node = (await figma.getNodeByIdAsync(sourceId)) as SceneNode | null
  if (!node || !node.parent) throw new Error(s().gone)
  if (paths === 0) throw new Error(s().emptySvg)

  log(s().inserting(paths))
  const startedAt = Date.now()

  const frame = figma.createNodeFromSvg(svg)
  frame.name = `${node.name} traced`

  // SVG приходит в пикселях трассировки — подгоняем под размер оригинала
  if (frame.width > 0) frame.rescale(node.width / frame.width)

  node.parent.appendChild(frame)
  frame.x = node.x + node.width + GAP
  frame.y = node.y

  figma.currentPage.selection = [frame]
  figma.viewport.scrollAndZoomIntoView([node, frame])

  log(s().inserted(frame.name, Date.now() - startedAt))
  post({ type: 'inserted', name: frame.name })
}

async function saveOptions(options: Options) {
  try {
    await figma.clientStorage.setAsync(OPTIONS_KEY, options)
  } catch (error) {
    log(s().optionsNotSaved(describe(error)))
  }
}

async function handleMessage(msg: UiMessage) {
  switch (msg.type) {
    case 'ui-ready': {
      let saved: Partial<Options> | undefined
      try {
        saved = (await figma.clientStorage.getAsync(OPTIONS_KEY)) as Partial<Options> | undefined
      } catch (error) {
        log(s().optionsNotRead(describe(error)))
      }
      if (saved && saved.lang) lang = saved.lang
      post({ type: 'options', options: saved || null })
      await pushSelection()
      break
    }
    case 'insert':
      try {
        await insertVectors(msg.sourceId, msg.svg, msg.paths)
      } catch (error) {
        log(describe(error))
        post({ type: 'error', message: describe(error) })
      }
      break
    case 'save-options':
      lang = msg.options.lang
      await saveOptions(msg.options)
      break
    case 'set-lang':
      lang = msg.lang
      break
    case 'select-node': {
      const node = (await figma.getNodeByIdAsync(msg.id)) as SceneNode | null
      if (node && node.parent) {
        figma.currentPage.selection = [node]
        figma.viewport.scrollAndZoomIntoView([node])
      }
      break
    }
  }
}

figma.ui.onmessage = (msg: UiMessage) => {
  // без обёртки исключение осталось бы необработанным промисом, а UI ждал бы ответа вечно
  handleMessage(msg).catch((error) => {
    log(s().handlerFailed(String(msg && msg.type), describe(error)))
    post({ type: 'error', message: describe(error) })
  })
}

figma.on('selectionchange', () => {
  void pushSelection()
})
