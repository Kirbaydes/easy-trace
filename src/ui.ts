/*
 * Easy Trace — trace images into editable vector silhouettes inside Figma.
 * Copyright (C) 2026 Kirill Baydakov
 *
 * Free software under the GNU General Public License, version 2 or later.
 * Bundles Potrace, Copyright (C) Peter Selinger, which is GPL-licensed —
 * see LICENSE and NOTICE in the project root.
 */

import ImageTracer from 'imagetracerjs'
import { init as potraceInit, potrace } from 'esm-potrace-wasm'
import type { Lang, Options, PluginMessage, SourceInfo } from './types'

/** Наибольшая сторона картинки перед трассировкой. Выше — дольше и без заметной пользы для силуэта. */
const TRACE_RESOLUTION = 1024
/** Настройки potrace: близко к его собственным умолчаниям, они хорошо выверены для силуэтов. */
const POTRACE = { turdsize: 4, alphamax: 1, opticurve: 1, opttolerance: 0.2 }
/** Запасной чисто-JS движок — включается, только если WebAssembly недоступен. */
const FALLBACK = { ltres: 1, qtres: 1, pathomit: 8 }
/** Дальше этого расстояния в RGB цвет уже не считается фоновым. */
const BG_TOLERANCE = 60
/** Столько путей Figma вставляет уже заметно медленно. */
const HEAVY_PATHS = 3000
const TRACE_DEBOUNCE = 350

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const el = {
  count: $('count'),
  lang: $('lang'),
  empty: $('empty'),
  emptyTitle: $('emptyTitle'),
  emptyText: $('emptyText'),
  sourceBlock: $('sourceBlock'),
  sourceThumb: $('sourceThumb'),
  sourceName: $('sourceName'),
  sourceSize: $('sourceSize'),
  extraNote: $('extraNote'),
  previewBlock: $('previewBlock'),
  view: $('view'),
  preview: $('preview'),
  previewEmpty: $('previewEmpty'),
  previewNote: $('previewNote'),
  settingsBlock: $('settingsBlock'),
  threshold: $<HTMLInputElement>('threshold'),
  thresholdValue: $('thresholdValue'),
  invert: $<HTMLInputElement>('invert'),
  removeBg: $<HTMLInputElement>('removeBg'),
  diagCard: $('diagCard'),
  diagBlock: $<HTMLDetailsElement>('diagBlock'),
  log: $('log'),
  copyLog: $<HTMLButtonElement>('copyLog'),
  error: $('error'),
  insertBtn: $<HTMLButtonElement>('insertBtn'),
}

/* ---------- языки ---------- */

const EN = {
  source: 'Source',
  result: 'Result',
  tracing: 'Tracing',
  viewTraced: 'Traced',
  viewOriginal: 'Original',
  threshold: 'Threshold',
  invert: 'Invert',
  removeBg: 'Transparent background',
  diagnostics: 'Diagnostics',
  copyLog: 'Copy log',
  copied: 'Copied',
  insert: 'Add vectors',
  inserting: 'Adding…',
  emptyNothing: 'Nothing selected',
  emptyNothingText: 'Select a layer that is filled with an image — Easy Trace turns it into an editable vector silhouette.',
  emptyNoImage: 'No image in the selection',
  emptyNoImageText: 'Easy Trace works on layers filled with an image. Place a picture into a frame or a shape and select it.',
  extra: (n: number) => `${n} more image ${n === 1 ? 'layer is' : 'layers are'} selected — tracing the first one.`,
  tracingNow: 'Tracing…',
  pathsFound: (n: number) => `${n} ${n === 1 ? 'path' : 'paths'}`,
  heavy: (n: number) => `${n} paths — that is a lot, Figma may take a while to insert it. Try a different threshold.`,
  noPaths: 'The trace produced nothing. Move the threshold, or turn Invert on.',
  inserted: (name: string) => `“${name}” added next to the original.`,
  units: (w: number, h: number) => `${w} × ${h} px`,
  showOnCanvas: 'Show on canvas',
  logDecoded: (w: number, h: number, ms: number) => `image decoded to ${w} × ${h} in ${ms} ms`,
  logTraced: (paths: number, ms: number, kb: string) => `traced: ${paths} paths, ${kb} KB of SVG in ${ms} ms`,
  logInsert: 'sending to the canvas…',
  logFailed: (text: string) => `tracing failed: ${text}`,
  logEngine: (name: string) => `tracing engine: ${name}`,
  logEngineFallback: (text: string) =>
    `potrace (wasm) unavailable, falling back to the pure-JS tracer: ${text}`,
}

const RU: typeof EN = {
  source: 'Исходник',
  result: 'Результат',
  tracing: 'Трассировка',
  viewTraced: 'Вектор',
  viewOriginal: 'Оригинал',
  threshold: 'Порог',
  invert: 'Инверсия',
  removeBg: 'Прозрачный фон',
  diagnostics: 'Диагностика',
  copyLog: 'Скопировать лог',
  copied: 'Скопировано',
  insert: 'Добавить вектор',
  inserting: 'Добавляю…',
  emptyNothing: 'Ничего не выбрано',
  emptyNothingText: 'Выдели слой с заливкой-картинкой — Easy Trace переведёт его в редактируемый векторный силуэт.',
  emptyNoImage: 'В выделении нет картинки',
  emptyNoImageText: 'Easy Trace работает со слоями, залитыми картинкой. Положи изображение во фрейм или фигуру и выдели её.',
  extra: (n: number) => `Выделено ещё ${n} ${n === 1 ? 'слой' : 'слоёв'} с картинкой — трассирую первый.`,
  tracingNow: 'Трассирую…',
  pathsFound: (n: number) => `${n} ${plural(n, 'путь', 'пути', 'путей')}`,
  heavy: (n: number) => `${n} путей — это много, вставка в Figma может подтормаживать. Попробуй другой порог.`,
  noPaths: 'Трассировка ничего не дала. Подвигай порог или включи инверсию.',
  inserted: (name: string) => `«${name}» добавлен рядом с оригиналом.`,
  units: (w: number, h: number) => `${w} × ${h} px`,
  showOnCanvas: 'Показать на холсте',
  logDecoded: (w: number, h: number, ms: number) => `картинка разобрана до ${w} × ${h} за ${ms} мс`,
  logTraced: (paths: number, ms: number, kb: string) => `трассировка: ${paths} путей, ${kb} КБ SVG за ${ms} мс`,
  logInsert: 'отправляю на холст…',
  logFailed: (text: string) => `трассировка упала: ${text}`,
  logEngine: (name: string) => `движок трассировки: ${name}`,
  logEngineFallback: (text: string) =>
    `potrace (wasm) недоступен, откатываюсь на чистый JS: ${text}`,
}

const DICT: Record<Lang, typeof EN> = { en: EN, ru: RU }
const t = () => DICT[options.lang]

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/* ---------- состояние ---------- */

const options: Options = {
  threshold: 128,
  removeBg: true,
  invert: false,
  lang: 'en',
}

type Note =
  | { kind: 'none' }
  | { kind: 'tracing' }
  | { kind: 'paths'; count: number }
  | { kind: 'heavy'; count: number }
  | { kind: 'empty' }
  | { kind: 'inserted'; name: string }

let source: SourceInfo | null = null
let sourceImage: ImageData | null = null
let originalUrl = ''
let tracedUrl = ''
let tracedSvg = ''
let tracedPaths = 0
let view: 'traced' | 'original' = 'traced'
let note: Note = { kind: 'none' }
let traceToken = 0
let debounce = 0
let inserting = false
let lastReason: 'nothing' | 'no-image' = 'nothing'
let lastExtra = 0

const startedAt = Date.now()
const logLines: string[] = []

function log(text: string) {
  const stamp = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(5, ' ')
  logLines.push(`${stamp}s  ${text}`)
  if (logLines.length > 400) logLines.shift()
  el.log.textContent = logLines.join('\n')
  el.log.scrollTop = el.log.scrollHeight
  el.diagCard.hidden = false
}

function send(message: unknown) {
  parent.postMessage({ pluginMessage: message }, '*')
}

function setNote(next: Note) {
  note = next
  renderNote()
}

function renderNote() {
  switch (note.kind) {
    case 'none':
      el.previewNote.textContent = ''
      break
    case 'tracing':
      el.previewNote.textContent = t().tracingNow
      break
    case 'paths':
      el.previewNote.textContent = t().pathsFound(note.count)
      break
    case 'heavy':
      el.previewNote.textContent = t().heavy(note.count)
      break
    case 'empty':
      el.previewNote.textContent = t().noPaths
      break
    case 'inserted':
      el.previewNote.textContent = t().inserted(note.name)
      break
  }
}

function showError(message: string) {
  el.error.hidden = false
  el.error.textContent = message
  el.diagBlock.open = true
}

function clearError() {
  el.error.hidden = true
}

/* ---------- движок ---------- */

let engine: 'potrace' | 'imagetracer' | null = null
let enginePromise: Promise<void> | null = null

/** Potrace живёт в WebAssembly. Если его не пустят, тихо откатываемся на чистый JS. */
function ensureEngine(): Promise<void> {
  if (!enginePromise) {
    enginePromise = potraceInit()
      .then(() => {
        engine = 'potrace'
        log(t().logEngine('potrace (wasm)'))
      })
      .catch((error) => {
        engine = 'imagetracer'
        log(t().logEngineFallback(error instanceof Error ? error.message : String(error)))
      })
  }
  return enginePromise
}

/* ---------- картинка ---------- */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = url
  })
}

async function decodeSource(bytes: Uint8Array) {
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))

  const decodedAt = Date.now()
  const img = await loadImage(originalUrl)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = Math.min(1, TRACE_RESOLUTION / longest)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  sourceImage = ctx.getImageData(0, 0, w, h)

  el.count.hidden = false
  el.count.textContent = t().units(img.naturalWidth, img.naturalHeight)
  el.sourceThumb.innerHTML = ''
  const thumb = new Image()
  thumb.src = originalUrl
  el.sourceThumb.appendChild(thumb)

  log(t().logDecoded(w, h, Date.now() - decodedAt))
}

/* ---------- трассировка ---------- */

interface Rgb {
  r: number
  g: number
  b: number
}

/** Копия картинки, где всё темнее порога — чёрное, остальное белое. */
function threshold(image: ImageData, level: number, invert: boolean): ImageData {
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
  const data = out.data
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    // прозрачные пиксели всегда считаем фоном, даже при инверсии
    const solid = alpha >= 128
    const dark = solid && (invert ? lum >= level : lum < level)
    const value = dark ? 0 : 255
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  return out
}

function distance(a: Rgb, b: Rgb) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function parseFill(value: string | null): Rgb | null {
  if (!value) return null
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const rgb = value.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  return rgb ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) } : null
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/**
 * Приводит SVG в порядок: выкидывает белые заливки фона, а если прозрачный фон не нужен —
 * наоборот подкладывает белый прямоугольник. Прогон через DOM заодно срезает XML-пролог
 * и DOCTYPE, которые Figma читать незачем.
 */
function cleanSvg(svg: string, transparent: boolean): { svg: string; paths: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement

  // potrace вешает цвет на <g>, imagetracer — на сам <path>
  for (const tag of ['g', 'path']) {
    const nodes = Array.prototype.slice.call(root.getElementsByTagName(tag)) as Element[]
    for (const node of nodes) {
      const fill = parseFill(node.getAttribute('fill'))
      if (fill && distance(fill, WHITE) <= BG_TOLERANCE) node.parentNode?.removeChild(node)
    }
  }

  if (!transparent) {
    const box = (root.getAttribute('viewBox') || '').split(/\s+/)
    const w = box[2] || root.getAttribute('width') || '0'
    const h = box[3] || root.getAttribute('height') || '0'
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', w)
    rect.setAttribute('height', h)
    rect.setAttribute('fill', '#ffffff')
    root.insertBefore(rect, root.firstChild)
  }

  return {
    svg: new XMLSerializer().serializeToString(root),
    paths: root.getElementsByTagName('path').length,
  }
}

async function tracePotrace(): Promise<string> {
  const image = threshold(sourceImage as ImageData, options.threshold, options.invert)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  ;(canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(image, 0, 0)
  return (await potrace(canvas, { ...POTRACE, extractcolors: false } as never)) as unknown as string
}

function traceFallback(): string {
  const image = threshold(sourceImage as ImageData, options.threshold, options.invert)
  return ImageTracer.imagedataToSVG(image, {
    ...FALLBACK,
    rightangleenhance: true,
    blurradius: 0,
    strokewidth: 1,
    linefilter: false,
    roundcoords: 1,
    viewbox: false,
    desc: false,
    scale: 1,
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
    colorsampling: 0 as const,
    colorquantcycles: 1,
  })
}

async function trace() {
  if (!sourceImage) return
  const token = ++traceToken

  el.preview.classList.add('is-busy')
  setNote({ kind: 'tracing' })
  el.insertBtn.disabled = true
  clearError()
  // отдаём кадр браузеру: пороговая обработка синхронная и надолго займёт поток
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (token !== traceToken) return

  try {
    await ensureEngine()
    if (token !== traceToken) return

    const tracedAt = Date.now()
    const raw = engine === 'potrace' ? await tracePotrace() : traceFallback()
    if (token !== traceToken) return

    const cleaned = cleanSvg(raw, options.removeBg)
    tracedSvg = cleaned.svg
    tracedPaths = cleaned.paths
    log(t().logTraced(cleaned.paths, Date.now() - tracedAt, (cleaned.svg.length / 1024).toFixed(0)))

    if (tracedUrl) URL.revokeObjectURL(tracedUrl)
    tracedUrl = URL.createObjectURL(new Blob([cleaned.svg], { type: 'image/svg+xml' }))
    renderPreview()

    el.insertBtn.disabled = cleaned.paths === 0
    setNote(
      cleaned.paths === 0
        ? { kind: 'empty' }
        : cleaned.paths > HEAVY_PATHS
          ? { kind: 'heavy', count: cleaned.paths }
          : { kind: 'paths', count: cleaned.paths }
    )
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    log(t().logFailed(text))
    showError(text)
    setNote({ kind: 'none' })
  } finally {
    if (token === traceToken) el.preview.classList.remove('is-busy')
  }
}

function scheduleTrace() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => trace(), TRACE_DEBOUNCE) as unknown as number
}

function renderPreview() {
  const url = view === 'original' ? originalUrl : tracedUrl
  el.preview.innerHTML = ''
  if (!url) {
    el.preview.appendChild(el.previewEmpty)
    return
  }
  const img = new Image()
  img.src = url
  el.preview.appendChild(img)
}

/* ---------- интерфейс ---------- */

function applyLang() {
  document.documentElement.lang = options.lang
  const strings = t() as unknown as Record<string, string>
  const nodes = document.querySelectorAll('[data-i18n]')
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as HTMLElement
    const value = strings[node.dataset.i18n as string]
    if (typeof value === 'string') node.textContent = value
  }
  Array.prototype.forEach.call(el.lang.children, (btn: HTMLElement) => {
    btn.classList.toggle('is-active', btn.dataset.value === options.lang)
  })
  el.copyLog.textContent = t().copyLog
  el.sourceName.title = t().showOnCanvas
  renderNote()
  renderEmptyState(lastReason, lastExtra)
  syncOptionsUi()
}

function syncOptionsUi() {
  Array.prototype.forEach.call(el.view.children, (btn: HTMLElement) => {
    btn.classList.toggle('is-active', btn.dataset.value === view)
  })
  el.threshold.value = String(options.threshold)
  el.thresholdValue.textContent = String(options.threshold)
  el.invert.checked = options.invert
  el.removeBg.checked = options.removeBg
  if (!inserting) el.insertBtn.textContent = t().insert
}

function renderEmptyState(reason: 'nothing' | 'no-image', extra: number) {
  lastReason = reason
  lastExtra = extra
  const noImage = reason === 'no-image'
  el.emptyTitle.textContent = noImage ? t().emptyNoImage : t().emptyNothing
  el.emptyText.textContent = noImage ? t().emptyNoImageText : t().emptyNothingText
  el.extraNote.hidden = extra === 0
  el.extraNote.textContent = extra > 0 ? t().extra(extra) : ''
}

function saveOptions() {
  send({ type: 'save-options', options })
}

el.lang.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest('.lang__btn') as HTMLElement | null
  if (!btn) return
  options.lang = btn.dataset.value as Lang
  applyLang()
  send({ type: 'set-lang', lang: options.lang })
  saveOptions()
})

el.view.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest('.seg__btn') as HTMLElement | null
  if (!btn) return
  view = btn.dataset.value as 'traced' | 'original'
  syncOptionsUi()
  renderPreview()
})

el.threshold.addEventListener('input', () => {
  options.threshold = Number(el.threshold.value)
  el.thresholdValue.textContent = el.threshold.value
  scheduleTrace()
})
el.threshold.addEventListener('change', saveOptions)

el.invert.addEventListener('change', () => {
  options.invert = el.invert.checked
  saveOptions()
  scheduleTrace()
})

el.removeBg.addEventListener('change', () => {
  options.removeBg = el.removeBg.checked
  saveOptions()
  scheduleTrace()
})

el.sourceName.addEventListener('click', () => {
  if (source) send({ type: 'select-node', id: source.id })
})

el.copyLog.addEventListener('click', () => {
  const area = document.createElement('textarea')
  area.value = logLines.join('\n')
  document.body.appendChild(area)
  area.select()
  try {
    document.execCommand('copy')
    el.copyLog.textContent = t().copied
    setTimeout(() => (el.copyLog.textContent = t().copyLog), 1500)
  } catch (_) {
    /* буфер недоступен — лог можно выделить руками */
  }
  area.remove()
})

el.insertBtn.addEventListener('click', () => {
  if (!source || !tracedSvg || inserting) return
  inserting = true
  el.insertBtn.disabled = true
  el.insertBtn.textContent = t().inserting
  clearError()
  log(t().logInsert)
  send({ type: 'insert', sourceId: source.id, svg: tracedSvg, paths: tracedPaths })
})

/* ---------- сообщения ---------- */

function setInsertIdle() {
  inserting = false
  el.insertBtn.textContent = t().insert
  el.insertBtn.disabled = tracedPaths === 0
}

window.onmessage = async (event: MessageEvent) => {
  const msg = event.data && (event.data.pluginMessage as PluginMessage | undefined)
  if (!msg) return

  switch (msg.type) {
    case 'options': {
      if (msg.options) Object.assign(options, msg.options)
      if (options.lang !== 'ru') options.lang = 'en'
      options.threshold = Math.max(10, Math.min(245, options.threshold || 128))
      send({ type: 'set-lang', lang: options.lang })
      applyLang()
      break
    }
    case 'log':
      log(msg.text)
      break
    case 'selection': {
      source = msg.source
      const has = source !== null
      el.empty.hidden = has
      el.sourceBlock.hidden = !has
      el.previewBlock.hidden = !has
      el.settingsBlock.hidden = !has
      el.insertBtn.disabled = true
      renderEmptyState(msg.reason, msg.extra)
      if (!has) {
        el.count.hidden = true
        tracedSvg = ''
        tracedPaths = 0
        setNote({ kind: 'none' })
        break
      }
      el.sourceName.textContent = source!.name
      el.sourceSize.textContent = t().units(source!.width, source!.height)
      break
    }
    case 'image': {
      if (!source || msg.id !== source.id) break
      try {
        await decodeSource(msg.bytes)
        await trace()
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        log(t().logFailed(text))
        showError(text)
      }
      break
    }
    case 'inserted':
      setInsertIdle()
      setNote({ kind: 'inserted', name: msg.name })
      break
    case 'error':
      showError(msg.message)
      setInsertIdle()
      break
  }
}

send({ type: 'ui-ready' })
