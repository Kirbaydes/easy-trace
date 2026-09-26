/*
 * Easy Trace — trace images into editable vector silhouettes inside Figma.
 * Copyright (C) 2026 Kirill Baydakov
 *
 * Free software under the GNU General Public License, version 2 or later.
 * Bundles Potrace, Copyright (C) Peter Selinger, which is GPL-licensed —
 * see LICENSE and NOTICE in the project root.
 */

declare module 'imagetracerjs' {
  interface TracerPalette {
    r: number
    g: number
    b: number
    a: number
  }

  interface TracerOptions {
    ltres?: number
    qtres?: number
    pathomit?: number
    rightangleenhance?: boolean
    colorsampling?: 0 | 1 | 2
    numberofcolors?: number
    mincolorratio?: number
    colorquantcycles?: number
    pal?: TracerPalette[]
    blurradius?: number
    blurdelta?: number
    strokewidth?: number
    linefilter?: boolean
    scale?: number
    roundcoords?: number
    viewbox?: boolean
    desc?: boolean
  }

  /** Принимает ImageData (или совместимый объект) и возвращает строку SVG. */
  function imagedataToSVG(image: ImageData, options?: TracerOptions): string

  const ImageTracer: {
    imagedataToSVG: typeof imagedataToSVG
  }

  export default ImageTracer
}
