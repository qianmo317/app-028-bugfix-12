/** 1:1 位图导出（canvas 直绘，尺寸 = mm / 25.4 × dpi，同一物理尺寸在不同 DPI 下 mm 不变） */
import { loadImage } from './image'
import { mmToPx } from './units'
import type { Paper, Placement, Sheet, Task } from './types'

export interface PngBuildInput {
  task: Task
  paper: Paper
  sheet: Sheet
  dpi: number
  photoOf: (p: Placement) => { key: string; url: string } | undefined
  sizeLabelOf: (p: Placement) => string
  /** 纸张外侧留出的标注带宽度（mm），保证校验尺与裁切标记不被裁掉 */
  borderMm?: number
}

export async function buildSheetPng(input: PngBuildInput): Promise<Blob> {
  const { paper, sheet, dpi } = input
  const border = input.borderMm ?? 12
  const k = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(mmToPx(paper.wMm + border * 2, dpi))
  canvas.height = Math.round(mmToPx(paper.hMm + border * 2, dpi))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  const X = (mm: number) => border * k + mm * k
  const Y = (mm: number) => border * k + mm * k

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 纸张外框
  ctx.strokeStyle = '#9aa6b4'
  ctx.lineWidth = Math.max(1, 0.2 * k)
  ctx.strokeRect(X(0), Y(0), paper.wMm * k, paper.hMm * k)

  // 毫米网格
  ctx.strokeStyle = '#eef1f6'
  ctx.lineWidth = Math.max(1, 0.12 * k)
  for (let x = 0; x <= paper.wMm; x += 10) {
    ctx.beginPath()
    ctx.moveTo(X(x), Y(0))
    ctx.lineTo(X(x), Y(paper.hMm))
    ctx.stroke()
  }
  for (let y = 0; y <= paper.hMm; y += 10) {
    ctx.beginPath()
    ctx.moveTo(X(0), Y(y))
    ctx.lineTo(X(paper.wMm), Y(y))
    ctx.stroke()
  }

  // 安全边
  const inset = paper.marginMm + input.task.safeEdgeMm
  ctx.save()
  ctx.setLineDash([4 * k, 3 * k])
  ctx.strokeStyle = '#c3ccd9'
  ctx.lineWidth = Math.max(1, 0.15 * k)
  ctx.strokeRect(X(inset), Y(inset), (paper.wMm - 2 * inset) * k, (paper.hMm - 2 * inset) * k)
  ctx.restore()

  // 照片
  for (const p of sheet.placements) {
    const ref = input.photoOf(p)
    if (ref) {
      try {
        const img = await loadImage(ref.url)
        ctx.save()
        ctx.beginPath()
        ctx.rect(X(p.x), Y(p.y), p.w * k, p.h * k)
        ctx.clip()
        // 等比铺满（cover）
        const scale = Math.max((p.w * k) / img.naturalWidth, (p.h * k) / img.naturalHeight)
        const dw = img.naturalWidth * scale
        const dh = img.naturalHeight * scale
        ctx.drawImage(img, X(p.x) + (p.w * k - dw) / 2, Y(p.y) + (p.h * k - dh) / 2, dw, dh)
        ctx.restore()
      } catch {
        ctx.fillStyle = '#eef2f7'
        ctx.fillRect(X(p.x), Y(p.y), p.w * k, p.h * k)
      }
    } else {
      ctx.fillStyle = '#eef2f7'
      ctx.fillRect(X(p.x), Y(p.y), p.w * k, p.h * k)
    }
    ctx.strokeStyle = '#6d7c8f'
    ctx.lineWidth = Math.max(1, 0.2 * k)
    ctx.strokeRect(X(p.x), Y(p.y), p.w * k, p.h * k)
    ctx.fillStyle = '#1f2733'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.max(8, 3.2 * k)}px system-ui, sans-serif`
    ctx.fillText(`#${p.seq}`, X(p.x + p.w / 2), Y(p.y + p.h / 2) - 1.6 * k)
    ctx.font = `${Math.max(7, 2.4 * k)}px system-ui, sans-serif`
    ctx.fillText(
      `${p.w.toFixed(0)}x${p.h.toFixed(0)}${p.rotated ? ' R' : ''}`,
      X(p.x + p.w / 2),
      Y(p.y + p.h / 2) + 1.8 * k,
    )
  }

  // 切割线
  ctx.save()
  ctx.strokeStyle = '#9aa6b4'
  ctx.lineWidth = Math.max(1, 0.22 * k)
  for (const c of sheet.cutSteps) {
    ctx.beginPath()
    if (c.axis === 'v') {
      ctx.moveTo(X(c.at), Y(c.from))
      ctx.lineTo(X(c.at), Y(c.to))
    } else {
      ctx.moveTo(X(c.from), Y(c.at))
      ctx.lineTo(X(c.to), Y(c.at))
    }
    ctx.stroke()
  }
  ctx.restore()

  // 100mm 校验尺
  const rulerY = Y(paper.hMm) + border * k * 0.55
  ctx.fillStyle = '#5a6572'
  ctx.font = `${Math.max(8, 2.6 * k)}px system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('100mm ruler (print at 100%)', X(0), rulerY)

  // 页眉 / 落款
  const sizeMm = Math.max(1.6, Math.min(4, paper.marginMm * 0.5))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1f2733'
  ctx.font = `${Math.max(7, sizeMm * k)}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  if (input.task.headerText.trim()) {
    ctx.fillText(input.task.headerText.trim(), X(paper.wMm / 2), Y(paper.marginMm / 2))
  }
  if (input.task.footerText.trim()) {
    ctx.fillText(
      input.task.footerText.trim(),
      X(paper.wMm / 2),
      Y(paper.hMm - paper.marginMm / 2),
    )
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG 生成失败'))
    }, 'image/png')
  })
}
