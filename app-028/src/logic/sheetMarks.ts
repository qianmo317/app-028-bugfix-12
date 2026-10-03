/**
 * 导出标注模型（唯一事实来源 = 当前切割方案 sheet.cutSteps）
 *
 * PDF、PNG、屏幕预览与打印视图都从这里取「刀序、纸边刻度、页眉落款位置」，
 * 保证同一张纸导成任何格式都是同一套内容；
 * 改完摆位、换纸或改页眉落款后重新计算（重新导出）即随之更新。
 */
import type { CutAxis, Paper, Sheet, Task } from './types'

/** 校验线长度（mm）：打印后用直尺量这段实线，自检是否 1:1 */
export const RULER_LENGTH_MM = 100

export interface CutMark {
  /** 刀序（1 起），顺序与 sheet.cutSteps 完全一致 */
  n: number
  axis: CutAxis
  at: number
  from: number
  to: number
  merged: boolean
  /** 刀序标签中心（mm，纸张坐标系）：沿切割线布置，已做防重叠避让 */
  lx: number
  ly: number
}

export type TickEdge = 'top' | 'bottom' | 'left' | 'right'

export interface EdgeTick {
  edge: TickEdge
  /** 沿纸边的坐标（top/bottom 为 x，left/right 为 y），已钳制在纸边范围内 */
  at: number
  /** 经过该刻度的刀序（同一坐标可能多刀共线） */
  cuts: number[]
}

export interface HeadFootMark {
  text: string
  /** 中心点（mm，纸张坐标系，y 自纸顶向下） */
  xMm: number
  yMm: number
  sizeMm: number
}

export interface SheetMarks {
  cuts: CutMark[]
  ticks: EdgeTick[]
  header: HeadFootMark | null
  footer: HeadFootMark | null
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 刀序标签的估算尺寸（mm）：PDF 与 PNG 用同一份，保证两种导出标签位置一致 */
const labelW = (n: number) => 1.8 * String(n).length + 1.6
const LABEL_H = 4.2
/** 沿线候选位置（优先中点，放不下时向两端避让） */
const FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88]

/**
 * 刀序标签防重叠：按刀序依次放置，每刀沿自己的切割线滑动，
 * 第一个不与已放标签相交的位置即落位（确定性：同一输入必得同一布局）
 */
function layoutCutLabels(cuts: CutMark[]): void {
  const placed: Array<{ x: number; y: number; w: number; h: number }> = []
  for (const c of cuts) {
    const w = labelW(c.n)
    const h = LABEL_H
    const len = c.to - c.from
    let best: { x: number; y: number } | null = null
    for (const f of FRACTIONS) {
      const pos = c.from + len * f
      const x = c.axis === 'v' ? c.at : pos
      const y = c.axis === 'v' ? pos : c.at
      const hit = placed.some(
        (p) => Math.abs(p.x - x) < (p.w + w) / 2 + 0.5 && Math.abs(p.y - y) < (p.h + h) / 2 + 0.5,
      )
      if (!hit) {
        best = { x, y }
        break
      }
    }
    if (!best) {
      const pos = c.from + len * 0.5
      best = c.axis === 'v' ? { x: c.at, y: pos } : { x: pos, y: c.at }
    }
    c.lx = best.x
    c.ly = best.y
    placed.push({ x: best.x, y: best.y, w, h })
  }
}

/** 刻度旁的标注文字：经过该刻度的刀序（可能多刀共线） */
export function tickLabel(t: EdgeTick): string {
  return t.cuts.join(',')
}

/** 刀序标签的估算盒（mm）：与防重叠布局同一份，供断言复核 */
export function cutLabelBox(c: CutMark): { w: number; h: number } {
  return { w: labelW(c.n), h: LABEL_H }
}

/** 页眉 / 落款共用布局：各自贴在上 / 下纸边留白带内、水平居中；没填则为 null */
export function headerFooterLayout(
  paper: Paper,
  headerText: string,
  footerText: string,
): { header: HeadFootMark | null; footer: HeadFootMark | null } {
  const sizeMm = clamp(paper.marginMm * 0.5, 1.5, 4)
  const cx = paper.wMm / 2
  // 纸边留白为 0 时仍把文字完整落在纸面内；上下两半互不越界
  const topY = clamp(paper.marginMm / 2, sizeMm / 2 + 0.3, paper.hMm / 2)
  const bottomY = clamp(paper.hMm - paper.marginMm / 2, paper.hMm / 2, paper.hMm - sizeMm / 2 - 0.3)
  const header = headerText.trim()
  const footer = footerText.trim()
  return {
    header: header ? { text: header, xMm: cx, yMm: topY, sizeMm } : null,
    footer: footer ? { text: footer, xMm: cx, yMm: bottomY, sizeMm } : null,
  }
}

/**
 * 由当前切割步骤推出导出标注：
 * - 刀序 = cutSteps 的顺序号（第几刀），走向 = from → to
 * - 纸边刻度 = 每刀坐标在垂直两条纸边上的投影（竖刀 → 上/下边，横刀 → 左/右边），同坐标去重
 * - 只有一刀、切割线正好压纸边（at = 0 或纸宽/纸高）时同样给出确定结果
 */
export function computeSheetMarks(
  sheet: Sheet,
  paper: Paper,
  task: Pick<Task, 'headerText' | 'footerText'>,
): SheetMarks {
  const cuts: CutMark[] = sheet.cutSteps.map((c, i) => ({
    n: i + 1,
    axis: c.axis,
    at: c.at,
    from: c.from,
    to: c.to,
    merged: c.merged,
    lx: 0,
    ly: 0,
  }))
  layoutCutLabels(cuts)

  const byEdge = new Map<TickEdge, Map<number, number[]>>()
  const addTick = (edge: TickEdge, rawAt: number, cutN: number, edgeLen: number) => {
    const at = round3(clamp(rawAt, 0, edgeLen))
    let m = byEdge.get(edge)
    if (!m) byEdge.set(edge, (m = new Map()))
    const list = m.get(at)
    if (list) list.push(cutN)
    else m.set(at, [cutN])
  }
  for (const c of cuts) {
    if (c.axis === 'v') {
      addTick('top', c.at, c.n, paper.wMm)
      addTick('bottom', c.at, c.n, paper.wMm)
    } else {
      addTick('left', c.at, c.n, paper.hMm)
      addTick('right', c.at, c.n, paper.hMm)
    }
  }
  const ticks: EdgeTick[] = []
  for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
    const m = byEdge.get(edge)
    if (!m) continue
    for (const [at, list] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
      ticks.push({ edge, at, cuts: list })
    }
  }

  const { header, footer } = headerFooterLayout(paper, task.headerText, task.footerText)
  return { cuts, ticks, header, footer }
}
