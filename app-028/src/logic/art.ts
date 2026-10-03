/**
 * 导出稿画面的「唯一事实来源」（single source of truth）：
 * PDF 与 1:1 图片都通过 paintSheetArt() 绘制同一套内容 ——
 *   · 纸外裁切标注带（边框）
 *   · 纸框 / 毫米网格 / 安全边
 *   · 照片（或编号占位）
 *   · 每一刀：贯通虚线 + 中段圆形刀序牌（序号与走向）+ 纸边短刻度（只在该刀真正切到纸边时）
 *   · 纸下方 100mm 实线校验尺（带 10mm 刻度）
 *   · 页眉（贴上纸边、水平居中）/ 落款（贴下纸边、水平居中）
 *   · 右上角「Sheet n/N WxHmm」（多张纸叠放时区分用）
 *
 * 刀序号取自 sheet.cutSteps 的当前顺序（1 起），刻度位置取自该刀的 at/from/to，
 * 因此改摆位、换纸、改页眉落款后重新导出，画面会随当前切割步骤自动更新。
 *
 * 坐标全部为「纸张坐标系」毫米值：(0,0) 为纸张左上角，y 向下；
 * 纸外标注带为负坐标（如 left 边在 x=-frame.left）。
 */
import type { Paper, Placement, Sheet, Task } from './types'

/** 与 guillotine.ts 的几何容差一致：小于 2µm 的偏移视为压线 */
const EPS = 2e-3

/** 导出稿配色（PDF 与 PNG 必须一致） */
export const INK = {
  paperFrame: '#9aa6b4',
  grid: '#eef1f6',
  safeEdge: '#c3ccd9',
  photoFill: '#eef2f7',
  photoFrame: '#6d7c8f',
  photoText: '#1f2733',
  cut: '#5d6b7d',
  badgeFill: '#ffffff',
  badgeText: '#2b3442',
  mark: '#3d4756',
  ruler: '#2f3947',
  header: '#1f2733',
  label: '#5a6572',
} as const

export interface SheetFrame {
  /** 左/右/上/下标注带宽（mm） */
  left: number
  right: number
  top: number
  bottom: number
  /** 整张导出图（含标注带）的尺寸 */
  widthMm: number
  heightMm: number
  /** 100mm 校验尺的几何（mm，纸张坐标系，y 向下） */
  rulerFromX: number
  rulerToX: number
  rulerY: number
}

/**
 * 计算一张纸的导出边框：
 * 左右要放得下 100mm 校验尺（纸不足 100mm 宽时向两侧标注带延伸，线本身恒为 100mm）；
 * 上边放行号，右边放行向刻度号，下边放校验尺实线/刻度数字/说明。
 */
export function computeFrame(paper: Paper): SheetFrame {
  // 100mm 校验线从纸左缘(x=0)起画；两侧边带要同时容下整条线和右端余量。
  // 左边带至少容下 x=0 左边的留白，右边带必须容下 (100 - 纸宽) 的伸出量。
  const minSide = 10
  const extendRight = Math.max(0, 100 - paper.wMm)
  const left = minSide
  const right = Math.max(minSide, Math.ceil(extendRight) + 2)
  const top = 9
  const bottom = 15
  const widthMm = left + paper.wMm + right
  const rulerFromX = 0
  const rulerToX = 100
  return {
    left,
    right,
    top,
    bottom,
    widthMm,
    heightMm: top + paper.hMm + bottom,
    rulerFromX,
    rulerToX,
    rulerY: paper.hMm + 8,
  }
}

/** 照片底图（解析失败或未导入时为 undefined，画编号占位） */
export interface ArtPhoto {
  key: string
  url: string
}

/**
 * 与具体输出格式无关的绘制后端。
 * 所有坐标均为纸张坐标系 mm；由后端负责 mm→pt / mm→px 与 y 轴翻转。
 */
export interface Painter {
  /** 填充矩形（照片占位等），线宽 mm */
  fillRect(x: number, y: number, w: number, h: number, color: string): void | Promise<void>
  /** 矩形描边 */
  strokeRect(x: number, y: number, w: number, h: number, color: string, widthMm?: number): void | Promise<void>
  /** 直线；dashMm 为 [实段, 空段]，省略为实线 */
  line(x1: number, y1: number, x2: number, y2: number, color: string, widthMm?: number, dashMm?: [number, number]): void | Promise<void>
  /**
   * 文字（水平）。
   * @param align center 时 x 为文字中点；right 时 x 为文字右端
   * @param halo   白色描边底，保证压在照片/线上仍清晰（刀序牌外的纸边行号用）
   */
  text(x: number, y: number, s: string, sizeMm: number, color: string, align?: 'left' | 'center' | 'right', halo?: boolean): void | Promise<void>
  /** 圆角矩形填充（刀序牌）；rx 省略时按高的一半画成胶囊/圆 */
  pill(cx: number, cy: number, w: number, h: number, fill: string, stroke: string, rx?: number): void | Promise<void>
  /** 照片（无底片或解码失败时后端自行画占位也可，但通常由调用方先画占位） */
  drawPhoto(photo: ArtPhoto, x: number, y: number, w: number, h: number): Promise<void>
}

/** 粗略西文字宽估算（mm），供居中/避让用；与后端真实字宽足够接近 */
function asciiWidth(s: string, sizeMm: number): number {
  return s.length * sizeMm * 0.56
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 水平方向贪心避让：给一组 x 坐标分配行号（0=贴边，1/2… 向外错开），最小间距 minGapMm */
function staggerRows(xs: number[], minGapMm: number): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const rows = new Array<number>(xs.length).fill(0)
  for (let k = 1; k < order.length; k++) {
    const i = order[k]
    let row = 0
    for (let j = 0; j < k; j++) {
      const p = order[j]
      if (Math.abs(xs[i] - xs[p]) < minGapMm && rows[p] >= row) row = rows[p] + 1
    }
    rows[i] = row
  }
  return rows
}

export interface PaintArtInput {
  task: Task
  paper: Paper
  sheet: Sheet
  /** 第几张（0 起），用于右上角 Sheet n/N */
  sheetIndex: number
  sheetCount: number
  frame: SheetFrame
  painter: Painter
  photoOf: (p: Placement) => ArtPhoto | undefined
  sizeLabelOf: (p: Placement) => string
  /** 是否画 10mm 网格（PDF/PNG 保持一致，默认画） */
  showGrid?: boolean
}

const asciiOnly = (s: string) => s.replace(/[^\x20-\x7E]/g, '')

/**
 * 画一张相纸的完整导出稿。PDF 与 PNG 共用本函数，
 * 因此「同一张纸导成 PDF 与图片」必然是同一套内容。
 */
export async function paintSheetArt(input: PaintArtInput): Promise<void> {
  const { task, paper, sheet, frame, painter: P } = input
  const W = paper.wMm
  const H = paper.hMm
  const showGrid = input.showGrid ?? true

  // ── 纸框 ──────────────────────────────────────────────
  P.strokeRect(0, 0, W, H, INK.paperFrame, 0.25)

  // ── 10mm 网格 ─────────────────────────────────────────
  if (showGrid) {
    for (let x = 10; x < W - EPS; x += 10) {
      await P.line(x, 0, x, H, INK.grid, 0.1)
    }
    for (let y = 10; y < H - EPS; y += 10) {
      await P.line(0, y, W, y, INK.grid, 0.1)
    }
  }

  // ── 安全边（虚线框） ──────────────────────────────────
  const inset = paper.marginMm + task.safeEdgeMm
  if (inset > EPS) {
    P.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset, INK.safeEdge, 0.15)
  }

  // ── 照片 ──────────────────────────────────────────────
  for (const p of sheet.placements) {
    const ref = input.photoOf(p)
    if (ref) {
      try {
        await P.drawPhoto(ref, p.x, p.y, p.w, p.h)
      } catch {
        P.fillRect(p.x, p.y, p.w, p.h, INK.photoFill)
      }
    } else {
      P.fillRect(p.x, p.y, p.w, p.h, INK.photoFill)
    }
    P.strokeRect(p.x, p.y, p.w, p.h, INK.photoFrame, 0.2)
    const noSize = clamp(p.h * 0.3, 2.6, 9)
    await P.text(p.x + p.w / 2, p.y + p.h / 2 - noSize * 0.62, `#${p.seq}`, noSize, INK.photoText, 'center', true)
    const labelSize = clamp(p.h * 0.19, 1.9, 4.2)
    const label = asciiOnly(input.sizeLabelOf(p))
    if (label) {
      await P.text(p.x + p.w / 2, p.y + p.h / 2 + noSize * 0.55, label, labelSize, INK.photoText, 'center', true)
    }
  }

  // ── 切割线：贯通虚线 + 刀序牌 + 纸边短刻度 ────────────
  const cuts = sheet.cutSteps
  const DASH: [number, number] = [2.2, 1.4]
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i]
    // 贯通虚线
    if (c.axis === 'v') {
      await P.line(c.at, c.from, c.at, c.to, INK.cut, 0.28, DASH)
    } else {
      await P.line(c.from, c.at, c.to, c.at, INK.cut, 0.28, DASH)
    }
  }

  // 纸边短刻度（先算避让行号，再画刻度与数字）
  const vCuts = cuts.filter((c) => c.axis === 'v')
  const hCuts = cuts.filter((c) => c.axis === 'h')
  // 只有切到对应纸边（压线即算）的刀才在该边出刻度
  const vTop = vCuts.map((c) => Math.abs(c.from - 0) <= EPS)
  const vBottom = vCuts.map((c) => Math.abs(c.to - H) <= EPS)
  const hLeft = hCuts.map((c) => Math.abs(c.from - 0) <= EPS)
  const hRight = hCuts.map((c) => Math.abs(c.to - W) <= EPS)
  const vRows = staggerRows(
    vCuts.filter((_, k) => vTop[k]).map((c) => c.at),
    5,
  )
  const hRows = staggerRows(
    hCuts.filter((_, k) => hRight[k]).map((c) => c.at),
    4.5,
  )

  const MARK_W = 0.25
  const TICK_OUT = 3.2 // 纸外段
  const TICK_IN = 1.8 // 纸内段
  const vIndex = new Map(vCuts.map((c, i) => [c, i]))
  const hIndex = new Map(hCuts.map((c, i) => [c, i]))
  let vi = 0
  vCuts.forEach((c, k) => {
    // 上下边短刻度（跨纸边）
    if (vTop[k]) {
      P.line(c.at, -TICK_OUT, c.at, TICK_IN, INK.mark, MARK_W)
      const row = vRows[vi++]
      P.text(c.at, -(TICK_OUT + 1.1) - row * 2.6, `${vIndex.get(c)! + 1}`, 2.6, INK.mark, 'center', true)
    }
    if (vBottom[k]) {
      P.line(c.at, H - TICK_IN, c.at, H + TICK_OUT, INK.mark, MARK_W)
    }
  })
  let hi = 0
  hCuts.forEach((c, k) => {
    if (hLeft[k]) P.line(-TICK_OUT, c.at, TICK_IN, c.at, INK.mark, MARK_W)
    if (hRight[k]) {
      P.line(W - TICK_IN, c.at, W + TICK_OUT, c.at, INK.mark, MARK_W)
      const row = hRows[hi++]
      P.text(W + TICK_OUT + 1.4, c.at - row * 2.6, `${hIndex.get(c)! + 1}`, 2.6, INK.mark, 'left', true)
    }
  })

  // 刀序牌（最后画，压在虚线中段，白底深色描边）
  const badge = clamp(Math.min(W, H) * 0.022, 2.6, 4.2)
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i]
    const label = `${i + 1}`
    const tw = asciiWidth(label, badge)
    const bw = Math.max(badge, tw + badge * 0.9)
    const cx = c.axis === 'v' ? c.at : (c.from + c.to) / 2
    const cy = c.axis === 'v' ? (c.from + c.to) / 2 : c.at
    await P.pill(cx, cy, bw, badge, INK.badgeFill, INK.cut, badge / 2)
    await P.text(cx, cy - badge * 0.36, label, badge * 0.72, INK.badgeText, 'center')
  }

  // ── 页眉 / 落款：各自贴住上/下纸边、水平居中 ─────────
  const headSize = clamp(paper.marginMm * 0.55, 1.8, 3.6)
  const header = task.headerText.trim()
  const footer = task.footerText.trim()
  if (header) {
    await P.text(W / 2, Math.max(headSize * 0.55, paper.marginMm / 2), header, headSize, INK.header, 'center')
  }
  if (footer) {
    await P.text(W / 2, H - Math.max(headSize * 0.55, paper.marginMm / 2), footer, headSize, INK.header, 'center')
  }

  // ── 右上角纸号（多张纸叠放区分用，纯 ASCII） ─────────
  const sheetTag = `Sheet ${input.sheetIndex + 1}/${input.sheetCount} ${Math.round(W)}x${Math.round(H)}mm`
  const tagSize = 2.2
  await P.text(W - 1.5, Math.max(tagSize * 0.7, 3.4), sheetTag, tagSize, INK.label, 'right')

  // ── 纸下方 100mm 实线校验尺 ───────────────────────────
  const ry = frame.rulerY
  await P.line(frame.rulerFromX, ry, frame.rulerToX, ry, INK.ruler, 0.5)
  for (let v = 0; v <= 100; v += 10) {
    const major = v % 50 === 0
    await P.line(v, ry, v, ry - (major ? 3 : 2), INK.ruler, 0.3)
    await P.text(v, ry - 4.2, `${v}`, 2.2, INK.label, 'center')
  }
  await P.text(frame.rulerFromX, ry + 3.2, '100mm calibration line - print at 100%, measure with a ruler', 2.4, INK.label, 'left')
}
