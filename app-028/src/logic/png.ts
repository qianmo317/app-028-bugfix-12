/**
 * 1:1 位图导出（canvas 直绘，尺寸 = mm / 25.4 × dpi，同一物理尺寸在不同 DPI 下 mm 不变）。
 * 画面内容由 paintSheetArt() 统一描述，与 PDF 完全一致（同一套刀序/刻度/校验尺/页眉落款）。
 */
import { loadImage } from './image'
import { computeFrame, paintSheetArt, type ArtPhoto, type Painter } from './art'
import { mmToPx } from './units'
import type { Paper, Placement, Sheet, Task } from './types'

export interface PngBuildInput {
  task: Task
  paper: Paper
  sheet: Sheet
  /** 本次任务的总相纸张数（右上角 Sheet n/N 用） */
  sheetCount: number
  dpi: number
  photoOf: (p: Placement) => ArtPhoto | undefined
  sizeLabelOf: (p: Placement) => string
}

/** hex -> rgba()，halo 用白色底块实现，颜色直接喂 canvas */
function hexToRgba(hex: string, alpha = 1): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}

/** Canvas 画面后端：输入纸张坐标系 mm（标注带为负坐标） */
class CanvasPainter implements Painter {
  k: number
  private dashPx: number[] = []

  constructor(
    private ctx: CanvasRenderingContext2D,
    private offXPx: number,
    private offYPx: number,
    k: number,
  ) {
    this.k = k
  }

  private X(mm: number): number {
    return this.offXPx + mm * this.k
  }
  private Y(mm: number): number {
    return this.offYPx + mm * this.k
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx
    ctx.fillStyle = hexToRgba(color)
    ctx.fillRect(this.X(x), this.Y(y), w * this.k, h * this.k)
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, widthMm = 0.2): void {
    const ctx = this.ctx
    ctx.save()
    ctx.setLineDash(this.dashPx)
    ctx.strokeStyle = hexToRgba(color)
    ctx.lineWidth = Math.max(1, widthMm * this.k)
    ctx.strokeRect(this.X(x), this.Y(y), w * this.k, h * this.k)
    ctx.restore()
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, widthMm = 0.2, dashMm?: [number, number]): void {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = hexToRgba(color)
    ctx.lineWidth = Math.max(1, widthMm * this.k)
    ctx.setLineDash(dashMm ? [dashMm[0] * this.k, dashMm[1] * this.k] : [])
    ctx.beginPath()
    ctx.moveTo(this.X(x1), this.Y(y1))
    ctx.lineTo(this.X(x2), this.Y(y2))
    ctx.stroke()
    ctx.restore()
  }

  text(
    x: number,
    y: number,
    s: string,
    sizeMm: number,
    color: string,
    align: 'left' | 'center' | 'right' = 'left',
    halo = false,
  ): void {
    const ctx = this.ctx
    const sizePx = Math.max(6, sizeMm * this.k)
    ctx.save()
    ctx.font = `${sizePx}px system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
    ctx.fillStyle = hexToRgba(color)
    ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'
    ctx.textBaseline = 'alphabetic'
    const tx = this.X(x)
    const ty = this.Y(y)
    if (halo) {
      const w = ctx.measureText(s).width
      const pad = Math.max(1, 0.5 * this.k)
      let bx = tx - pad
      if (align === 'center') bx = tx - w / 2 - pad
      else if (align === 'right') bx = tx - w - pad
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(bx, ty - sizePx * 0.92, w + pad * 2, sizePx * 1.18)
      ctx.fillStyle = hexToRgba(color)
    }
    ctx.fillText(s, tx, ty)
    ctx.restore()
  }

  pill(cx: number, cy: number, w: number, h: number, fill: string, stroke: string): void {
    const ctx = this.ctx
    const x = this.X(cx - w / 2)
    const y = this.Y(cy - h / 2)
    const ww = w * this.k
    const hh = h * this.k
    const r = hh / 2
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + ww, y, x + ww, y + hh, r)
    ctx.arcTo(x + ww, y + hh, x, y + hh, r)
    ctx.arcTo(x, y + hh, x, y, r)
    ctx.arcTo(x, y, x + ww, y, r)
    ctx.closePath()
    ctx.fillStyle = hexToRgba(fill)
    ctx.fill()
    ctx.strokeStyle = hexToRgba(stroke)
    ctx.lineWidth = Math.max(1, 0.18 * this.k)
    ctx.stroke()
    ctx.restore()
  }

  async drawPhoto(photo: ArtPhoto, x: number, y: number, w: number, h: number): Promise<void> {
    const ctx = this.ctx
    const img = await loadImage(photo.url)
    ctx.save()
    ctx.beginPath()
    ctx.rect(this.X(x), this.Y(y), w * this.k, h * this.k)
    ctx.clip()
    // 等比铺满（cover）
    const scale = Math.max((w * this.k) / img.naturalWidth, (h * this.k) / img.naturalHeight)
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    ctx.drawImage(img, this.X(x) + (w * this.k - dw) / 2, this.Y(y) + (h * this.k - dh) / 2, dw, dh)
    ctx.restore()
  }
}

export async function buildSheetPng(input: PngBuildInput): Promise<Blob> {
  const { paper, sheet, dpi } = input
  const frame = computeFrame(paper)
  const k = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(mmToPx(frame.widthMm, dpi))
  canvas.height = Math.round(mmToPx(frame.heightMm, dpi))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const painter = new CanvasPainter(ctx, frame.left * k, frame.top * k, k)
  await paintSheetArt({
    task: input.task,
    paper,
    sheet,
    sheetIndex: sheet.index,
    sheetCount: input.sheetCount,
    frame,
    painter,
    photoOf: input.photoOf,
    sizeLabelOf: input.sizeLabelOf,
  })

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG 生成失败'))
    }, 'image/png')
  })
}
