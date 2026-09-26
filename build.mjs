/*
 * Easy Trace — trace images into editable vector silhouettes inside Figma.
 * Copyright (C) 2026 Kirill Baydakov
 *
 * Free software under the GNU General Public License, version 2 or later.
 * Bundles Potrace, Copyright (C) Peter Selinger, which is GPL-licensed —
 * see LICENSE and NOTICE in the project root.
 */

import esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

/**
 * esm-potrace-wasm тащит внутри ветку для Node с require('node:fs').
 * В браузере она не исполняется, но сборщику её надо чем-то закрыть.
 */
const stubNodeBuiltins = {
  name: 'stub-node-builtins',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
  },
}

const watch = process.argv.includes('--watch')
mkdirSync('dist', { recursive: true })

/** Инлайнит собранный JS прямо в ui.html — Figma грузит UI одним файлом. */
const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text
      const html = readFileSync('src/ui.html', 'utf8').replace('/*__JS__*/', () => js)
      writeFileSync('dist/ui.html', html)
      console.log(`[easy-trace] ui.html ${(html.length / 1024).toFixed(0)} kB`)
    })
  },
}

/** Уведомление должно ехать и в минифицированной сборке — этого требует GPL. */
const banner = {
  js:
    '/* Easy Trace — Copyright (C) 2026 Kirill Baydakov. GPL-2.0-or-later.\n' +
    ' * Bundles Potrace (C) Peter Selinger and ImageTracer.js (Unlicense).\n' +
    ' * Source: https://github.com/Kirbaydes/easy-trace */',
}

const common = { bundle: true, target: 'es2020', logLevel: 'info', banner }

const codeCtx = await esbuild.context({
  ...common,
  entryPoints: ['src/code.ts'],
  outfile: 'dist/code.js',
  format: 'iife',
  minify: !watch,
})

const uiCtx = await esbuild.context({
  ...common,
  entryPoints: ['src/ui.ts'],
  outfile: 'dist/ui.js',
  format: 'iife',
  write: false,
  minify: !watch,
  plugins: [stubNodeBuiltins, inlineUi],
})

if (watch) {
  await Promise.all([codeCtx.watch(), uiCtx.watch()])
  console.log('[easy-trace] watching…')
} else {
  await Promise.all([codeCtx.rebuild(), uiCtx.rebuild()])
  await Promise.all([codeCtx.dispose(), uiCtx.dispose()])
}
