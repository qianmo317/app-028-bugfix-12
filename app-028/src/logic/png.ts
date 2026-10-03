/**
 * 1:1 位图导出（canvas 直绘，尺寸 = mm / 25.4 × dpi，同一物理尺寸在不同 DPI 下 mm 不变）
 * 刀序 / 纸边刻度 / 页眉落款与 PDF 出自同一份标注模型（sheetMarks.ts），同一张纸内容一致；
 * 与 PDF 的差异只在介质：PNG 有纸外标注带，刻度同坐标探出纸外（裁切标记），100mm 校验尺画在纸下方。
 */
import { loadImage } from './image'
import { computeSheetMarks, RULER_LENGTH_MM, tickLabel } from './sheetMarks'
import { mmToPx } from './units'
import type { Paper, Placement, Sheet, Task } from './types'

export interface PngBuildInput {
  task: Task
  paper: Paper
  sheet: Sheet
  dpi: number
  photoOf: (p: Placement) => { key: string; url: string } | undefined
  sizeLabelOf: (p: Placement) => string
  /** 纸张外侧留出的标注带宽度（mm，下侧会自动加宽以容纳校验尺与裁切标记） */
  borderMm?: number
  /** 总张数（用于「Sheet i/n」标记，与 PDF 页脚一致） */
  sheetCount?: number
}

const CUT_COLOR = '#c62828'

export async function buildSheetPng(input: PngBuildInput): Promise<Blob> {
  const { paper, sheet, dpi } = input
  const border = Math.max(12, input.borderMm ?? 12)
  const bottomBand = Math.max(border, 17)
  const k = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(mmToPx(Math.max(paper.wMm, RULER_LENGTH_MM) + border * 2, dpi))
  canvas.height = Math.round(mmToPx(paper.hMm + border + bottomBand, dpi))
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

  // 导出标注：与 PDF 同一套（由当前切割步骤算出）
  const marks = computeSheetMarks(sheet, paper, input.task)

  // Sheet i/n 标记（与 PDF 页脚同一内容，画在纸外上侧标注带）
  ctx.fillStyle = '#5a6572'
  ctx.font = `${Math.max(8, 2.4 * k)}px system-ui, sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    `Sheet ${sheet.index + 1}${input.sheetCount ? `/${input.sheetCount}` : ''}  ${paper.wMm}×${paper.hMm}mm  1:1`,
    X(paper.wMm) + border * k - 2 * k,
    Y(0) - border * k * 0.5,
  )

  // 切割线：红色虚线 + 走向箭头 + 刀序标签
  if (marks.cuts.length) {
    ctx.save()
    ctx.strokeStyle = CUT_COLOR
    ctx.lineWidth = Math.max(1, 0.22 * k)
    ctx.setLineDash([2.2 * k, 1.4 * k])
    for (const c of marks.cuts) {
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
    // 走向箭头（from → to）
    ctx.fillStyle = CUT_COLOR
    const aw = 1.1 * k
    const al = 1.8 * k
    for (const c of marks.cuts) {
      ctx.beginPath()
      if (c.axis === 'v') {
        ctx.moveTo(X(c.at), Y(c.to))
        ctx.lineTo(X(c.at) - aw, Y(c.to) - al)
        ctx.lineTo(X(c.at) + aw, Y(c.to) - al)
      } else {
        ctx.moveTo(X(c.to), Y(c.at))
        ctx.lineTo(X(c.to) - al, Y(c.at) - aw)
        ctx.lineTo(X(c.to) - al, Y(c.at) + aw)
      }
      ctx.closePath()
      ctx.fill()
    }
    // 刀序标签（白底红框，位置由 sheetMarks 防重叠布局给出，与 PDF 一致）
    const fontPx = Math.max(10, 3 * k)
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const c of marks.cuts) {
      const label = String(c.n)
      const cx = X(c.lx)
      const cy = Y(c.ly)
      const bw = ctx.measureText(label).width + 1.6 * k
      const bh = fontPx * 1.3
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh)
      ctx.strokeStyle = CUT_COLOR
      ctx.lineWidth = Math.max(1, 0.16 * k)
      ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh)
      ctx.fillStyle = CUT_COLOR
      ctx.fillText(label, cx, cy)
    }
  }

  // 纸边裁切刻度（纸内 3mm）+ 纸外裁切标记（同坐标探出 6mm）
  const tickLen = 3
  ctx.save()
  ctx.strokeStyle = CUT_COLOR
  ctx.lineWidth = Math.max(1, 0.24 * k)
  for (const t of marks.ticks) {
    ctx.beginPath()
    if (t.edge === 'top') {
      ctx.moveTo(X(t.at), Y(0))
      ctx.lineTo(X(t.at), Y(tickLen))
    } else if (t.edge === 'bottom') {
      ctx.moveTo(X(t.at), Y(paper.hMm - tickLen))
      ctx.lineTo(X(t.at), Y(paper.hMm))
    } else if (t.edge === 'left') {
      ctx.moveTo(X(0), Y(t.at))
      ctx.lineTo(X(tickLen), Y(t.at))
    } else {
      ctx.moveTo(X(paper.wMm - tickLen), Y(t.at))
      ctx.lineTo(X(paper.wMm), Y(t.at))
    }
    ctx.stroke()
    ctx.beginPath()
    if (t.edge === 'top') {
      ctx.moveTo(X(t.at), Y(0))
      ctx.lineTo(X(t.at), Y(-6))
    } else if (t.edge === 'bottom') {
      ctx.moveTo(X(t.at), Y(paper.hMm))
      ctx.lineTo(X(t.at), Y(paper.hMm + 6))
    } else if (t.edge === 'left') {
      ctx.moveTo(X(0), Y(t.at))
      ctx.lineTo(X(-6), Y(t.at))
    } else {
      ctx.moveTo(X(paper.wMm), Y(t.at))
      ctx.lineTo(X(paper.wMm + 6), Y(t.at))
    }
    ctx.stroke()
  }
  ctx.restore()
  // 刻度旁的刀序小字
  ctx.fillStyle = CUT_COLOR
  ctx.font = `${Math.max(8, 1.9 * k)}px system-ui, sans-serif`
  for (const t of marks.ticks) {
    const label = tickLabel(t)
    if (t.edge === 'top') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(label, X(t.at), Y(tickLen + 0.5))
    } else if (t.edge === 'bottom') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(label, X(t.at), Y(paper.hMm - tickLen - 0.5))
    } else if (t.edge === 'left') {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, X(tickLen + 0.7), Y(t.at))
    } else {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, X(paper.wMm - tickLen - 0.7), Y(t.at))
    }
  }

  // 100mm 校验尺：纸下方一根可量的实线 + 刻度 + 读数（与 PDF 校验页那把尺同长）
  const rulerY = Y(paper.hMm) + 10.5 * k
  ctx.strokeStyle = '#1f2733'
  ctx.lineWidth = Math.max(1.2, 0.35 * k)
  ctx.beginPath()
  ctx.moveTo(X(0), rulerY)
  ctx.lineTo(X(RULER_LENGTH_MM), rulerY)
  ctx.stroke()
  ctx.lineWidth = Math.max(1, 0.24 * k)
  for (let v = 0; v <= RULER_LENGTH_MM; v += 10) {
    ctx.beginPath()
    ctx.moveTo(X(v), rulerY)
    ctx.lineTo(X(v), rulerY + 2.2 * k)
    ctx.stroke()
  }
  ctx.fillStyle = '#1f2733'
  ctx.font = `${Math.max(8, 2.4 * k)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let v = 0; v <= RULER_LENGTH_MM; v += 10) {
    ctx.fillText(`${v}`, X(v), rulerY + 2.8 * k)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.font = `${Math.max(9, 2.6 * k)}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillText('100mm 校验尺：打印后用直尺量这段实线，必须正好 100mm', X(0), rulerY - 1.4 * k)

  // 页眉 / 落款：分别贴上、下纸边居中（与 PDF 同一坐标）；没填则不画
  for (const hf of [marks.header, marks.footer]) {
    if (!hf) continue
    ctx.fillStyle = '#1f2733'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.max(7, hf.sizeMm * k)}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(hf.text, X(hf.xMm), Y(hf.yMm))
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG 生成失败'))
    }, 'image/png')
  })
}
