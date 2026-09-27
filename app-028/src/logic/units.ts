/** 单位换算：内部一律 mm，像素只在导出时按 DPI 换算 */

export const MM_PER_INCH = 25.4
export const PT_PER_INCH = 72
export const MM_TO_PT = PT_PER_INCH / MM_PER_INCH

/** mm -> px（px = mm / 25.4 × dpi） */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi
}

/** px -> mm */
export function pxToMm(px: number, dpi: number): number {
  return (px * MM_PER_INCH) / dpi
}

/** mm -> pt（PDF 用户单位，1pt = 1/72 英寸） */
export function mmToPt(mm: number): number {
  return mm * MM_TO_PT
}

export function ptToMm(pt: number): number {
  return pt / MM_TO_PT
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH
}

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH
}

/** 四舍五入到指定小数位，避免浮点噪声 */
export function round(n: number, digits = 3): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

/** 面积 mm² */
export function areaMm2(wMm: number, hMm: number): number {
  return wMm * hMm
}

export function formatMm(n: number, digits = 1): string {
  return `${round(n, digits)}mm`
}

export function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

export function formatPercent(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`
}
