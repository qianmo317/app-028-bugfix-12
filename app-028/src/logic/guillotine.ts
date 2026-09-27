/**
 * guillotine（贯通直刀）几何核心：
 *  - decompose: 把一组互不重叠的矩形递归二分拆解成「每一步都贯通当前块」的切割线序列
 *  - mergeCollinearCuts: 共边合并（同一坐标的相接切割线合成一条）
 *  - validateCutSequence: 逐步重放切割线，断言每一步都完全贯通当前矩形且不切断照片
 */
import type { CutAxis, CutStep, Placement } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CutLine {
  axis: CutAxis
  at: number
  from: number
  to: number
}

/** 几何容差（mm）：1 微米级，远小于 0.5mm 的验收误差要求 */
export const EPS = 2e-3

export function rectsEqual(a: Rect, b: Rect, eps = EPS): boolean {
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.w - b.w) < eps &&
    Math.abs(a.h - b.h) < eps
  )
}

export function rectContains(outer: Rect, inner: Rect, eps = EPS): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  )
}

/** 照片实际矩形 -> 刀口切块矩形（刀宽/隙距从照片外侧向内缩补偿） */
export function slotOf(p: Placement, kerfMm: number, gapMm: number): Rect {
  const m = (kerfMm + gapMm) / 2
  return { x: p.x - m, y: p.y - m, w: p.w + 2 * m, h: p.h + 2 * m }
}

export function slotOfRect(r: Rect, kerfMm: number, gapMm: number): Rect {
  const m = (kerfMm + gapMm) / 2
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }
}

interface Candidate {
  axis: CutAxis
  at: number
  aRects: Rect[]
  bRects: Rect[]
  aRegion: Rect
  bRegion: Rect
  edgeCount: number
  both: boolean
  areaSum: number
}

function buildCandidates(region: Rect, rects: Rect[]): Candidate[] {
  const out: Candidate[] = []
  const xs = new Set<number>()
  const ys = new Set<number>()
  for (const r of rects) {
    xs.add(r.x)
    xs.add(r.x + r.w)
    ys.add(r.y)
    ys.add(r.y + r.h)
  }
  const collect = (axis: CutAxis, coords: Set<number>) => {
    for (const at of coords) {
      if (axis === 'v') {
        if (at <= region.x + EPS || at >= region.x + region.w - EPS) continue
      } else {
        if (at <= region.y + EPS || at >= region.y + region.h - EPS) continue
      }
      let spans = false
      for (const r of rects) {
        if (axis === 'v') {
          if (r.x < at - EPS && r.x + r.w > at + EPS) {
            spans = true
            break
          }
        } else if (r.y < at - EPS && r.y + r.h > at + EPS) {
          spans = true
          break
        }
      }
      if (spans) continue
      const a: Rect[] = []
      const b: Rect[] = []
      for (const r of rects) {
        const lo = axis === 'v' ? r.x : r.y
        const hi = lo + (axis === 'v' ? r.w : r.h)
        if (hi <= at + EPS) a.push(r)
        else if (lo >= at - EPS) b.push(r)
      }
      if (a.length + b.length !== rects.length) continue
      const aRegion: Rect =
        axis === 'v'
          ? { x: region.x, y: region.y, w: at - region.x, h: region.h }
          : { x: region.x, y: region.y, w: region.w, h: at - region.y }
      const bRegion: Rect =
        axis === 'v'
          ? { x: at, y: region.y, w: region.x + region.w - at, h: region.h }
          : { x: region.x, y: at, w: region.w, h: region.y + region.h - at }
      let edgeCount = 0
      for (const r of rects) {
        const lo = axis === 'v' ? r.x : r.y
        const hi = lo + (axis === 'v' ? r.w : r.h)
        if (Math.abs(lo - at) < EPS || Math.abs(hi - at) < EPS) edgeCount++
      }
      out.push({
        axis,
        at,
        aRects: a,
        bRects: b,
        aRegion,
        bRegion,
        edgeCount,
        both: a.length > 0 && b.length > 0,
        areaSum: aRegion.w * aRegion.h + bRegion.w * bRegion.h,
      })
    }
  }
  collect('v', xs)
  collect('h', ys)
  return out
}

function candidateScore(c: Candidate): number[] {
  return [
    // 优先沿「一边为空」的位置把废料切掉，减少后续修边刀
    c.both ? 1 : 0,
    Math.abs(c.aRects.length - c.bRects.length),
    -c.edgeCount,
    c.areaSum,
  ]
}

/** 只剩一张照片时，用修边刀把废料切掉，保证照片被完整分出 */
function trimCuts(region: Rect, r: Rect): CutLine[] {
  const out: CutLine[] = []
  let cur: Rect = { ...region }
  if (r.y > cur.y + EPS) {
    out.push({ axis: 'h', at: r.y, from: cur.x, to: cur.x + cur.w })
    cur = { x: cur.x, y: r.y, w: cur.w, h: cur.y + cur.h - r.y }
  }
  if (r.y + r.h < cur.y + cur.h - EPS) {
    out.push({ axis: 'h', at: r.y + r.h, from: cur.x, to: cur.x + cur.w })
    cur = { ...cur, h: r.h }
  }
  if (r.x > cur.x + EPS) {
    out.push({ axis: 'v', at: r.x, from: cur.y, to: cur.y + cur.h })
    cur = { x: r.x, y: cur.y, w: cur.x + cur.w - r.x, h: cur.h }
  }
  if (r.x + r.w < cur.x + cur.w - EPS) {
    out.push({ axis: 'v', at: r.x + r.w, from: cur.y, to: cur.y + cur.h })
    cur = { ...cur, w: r.w }
  }
  return out
}

/** 递归二分（guillotine split）拆解，返回贯通切割线序列；不可拆解时返回 null */
export function decompose(
  region: Rect,
  rects: Rect[],
  budget: { n: number } = { n: 60000 },
): CutLine[] | null {
  for (const r of rects) {
    if (!rectContains(region, r)) return null
  }
  if (rects.length === 0) return []
  if (rects.length === 1) return trimCuts(region, rects[0])
  const cands = buildCandidates(region, rects)
  cands.sort((p, q) => {
    const sp = candidateScore(p)
    const sq = candidateScore(q)
    for (let i = 0; i < sp.length; i++) {
      if (sp[i] !== sq[i]) return sp[i] - sq[i]
    }
    return 0
  })
  for (const c of cands) {
    if (budget.n-- <= 0) return null
    const a = decompose(c.aRegion, c.aRects, budget)
    if (!a) continue
    const b = decompose(c.bRegion, c.bRects, budget)
    if (!b) continue
    const cut: CutLine =
      c.axis === 'v'
        ? { axis: 'v', at: c.at, from: region.y, to: region.y + region.h }
        : { axis: 'h', at: c.at, from: region.x, to: region.x + region.w }
    return [cut, ...a, ...b]
  }
  return null
}

/** 共边合并：同一坐标上相接/重叠的切割线合成一条 */
export function mergeCollinearCuts(cuts: CutLine[]): CutLine[] {
  const groups = new Map<string, CutLine[]>()
  const order: string[] = []
  for (const c of cuts) {
    const key = `${c.axis}@${c.at.toFixed(6)}`
    let g = groups.get(key)
    if (!g) {
      g = []
      groups.set(key, g)
      order.push(key)
    }
    g.push(c)
  }
  const merged: CutLine[] = []
  for (const key of order) {
    const g = groups.get(key)!.slice().sort((a, b) => a.from - b.from)
    let cur: CutLine = { ...g[0] }
    for (let i = 1; i < g.length; i++) {
      if (g[i].from <= cur.to + EPS) {
        cur.to = Math.max(cur.to, g[i].to)
      } else {
        merged.push(cur)
        cur = { ...g[i] }
      }
    }
    merged.push(cur)
  }
  return merged
}

export interface Piece {
  r: Rect
  idx: number[]
}

export interface ValidateResult {
  ok: boolean
  reason: string
  failedStep: number
  pieces: Piece[]
}

/** 逐步重放切割线：每一步必须完全贯通当前矩形，且不得切断任何照片 */
export function validateCutSequence(
  region: Rect,
  slots: Rect[],
  cuts: CutLine[],
): ValidateResult {
  let pieces: Piece[] = [{ r: { ...region }, idx: slots.map((_, i) => i) }]
  const fail = (reason: string, step: number): ValidateResult => ({
    ok: false,
    reason,
    failedStep: step,
    pieces,
  })
  for (let s = 0; s < cuts.length; s++) {
    const c = cuts[s]
    const affected: Piece[] = []
    for (const p of pieces) {
      if (c.axis === 'v') {
        if (
          p.r.x < c.at - EPS &&
          c.at < p.r.x + p.r.w - EPS &&
          c.from <= p.r.y + EPS &&
          p.r.y + p.r.h <= c.to + EPS
        ) {
          affected.push(p)
        }
      } else if (
        p.r.y < c.at - EPS &&
        c.at < p.r.y + p.r.h - EPS &&
        c.from <= p.r.x + EPS &&
        p.r.x + p.r.w <= c.to + EPS
      ) {
        affected.push(p)
      }
    }
    if (affected.length === 0) {
      return fail(`第 ${s + 1} 步切割线未落在任何待切块内`, s + 1)
    }
    // 切割线不能部分穿过某个块（必须整块贯通）
    for (const p of pieces) {
      if (affected.includes(p)) continue
      const inside =
        c.axis === 'v'
          ? p.r.x < c.at - EPS && c.at < p.r.x + p.r.w - EPS
          : p.r.y < c.at - EPS && c.at < p.r.y + p.r.h - EPS
      if (!inside) continue
      const lo = c.axis === 'v' ? p.r.y : p.r.x
      const hi = lo + (c.axis === 'v' ? p.r.h : p.r.w)
      if (Math.min(hi, c.to) - Math.max(lo, c.from) > EPS) {
        return fail(`第 ${s + 1} 步切割线未贯通当前块（只切到一半）`, s + 1)
      }
    }
    // 被切块在垂直方向上的并集必须恰好等于 [from, to]
    const iv = affected
      .map((p) =>
        c.axis === 'v'
          ? ([p.r.y, p.r.y + p.r.h] as [number, number])
          : ([p.r.x, p.r.x + p.r.w] as [number, number]),
      )
      .sort((a, b) => a[0] - b[0])
    if (Math.abs(iv[0][0] - c.from) > EPS) {
      return fail(`第 ${s + 1} 步切割线起点未与待切块对齐`, s + 1)
    }
    for (let i = 1; i < iv.length; i++) {
      if (iv[i][0] > iv[i - 1][1] + EPS) {
        return fail(`第 ${s + 1} 步切割线跨越了空隙，未贯通到底`, s + 1)
      }
    }
    if (Math.abs(iv[iv.length - 1][1] - c.to) > EPS) {
      return fail(`第 ${s + 1} 步切割线终点未与待切块对齐`, s + 1)
    }
    // 不得切断照片
    for (const p of affected) {
      for (const i of p.idx) {
        const sl = slots[i]
        const crosses =
          c.axis === 'v'
            ? sl.x < c.at - EPS && sl.x + sl.w > c.at + EPS
            : sl.y < c.at - EPS && sl.y + sl.h > c.at + EPS
        if (crosses) return fail(`第 ${s + 1} 步切割线穿过了第 ${i + 1} 张照片`, s + 1)
      }
    }
    const rest = pieces.filter((p) => !affected.includes(p))
    const next: Piece[] = []
    for (const p of affected) {
      if (c.axis === 'v') {
        const left = p.idx.filter((i) => slots[i].x + slots[i].w <= c.at + EPS)
        const right = p.idx.filter((i) => slots[i].x >= c.at - EPS)
        if (left.length + right.length !== p.idx.length) {
          return fail(`第 ${s + 1} 步切割线跨越了照片边界`, s + 1)
        }
        next.push({ r: { x: p.r.x, y: p.r.y, w: c.at - p.r.x, h: p.r.h }, idx: left })
        next.push({
          r: { x: c.at, y: p.r.y, w: p.r.x + p.r.w - c.at, h: p.r.h },
          idx: right,
        })
      } else {
        const top = p.idx.filter((i) => slots[i].y + slots[i].h <= c.at + EPS)
        const bottom = p.idx.filter((i) => slots[i].y >= c.at - EPS)
        if (top.length + bottom.length !== p.idx.length) {
          return fail(`第 ${s + 1} 步切割线跨越了照片边界`, s + 1)
        }
        next.push({ r: { x: p.r.x, y: p.r.y, w: p.r.w, h: c.at - p.r.y }, idx: top })
        next.push({
          r: { x: p.r.x, y: c.at, w: p.r.w, h: p.r.y + p.r.h - c.at },
          idx: bottom,
        })
      }
    }
    pieces = [...rest, ...next]
  }
  // 全部切完后每张照片必须被独立分出
  for (let i = 0; i < slots.length; i++) {
    const ok = pieces.some((p) => p.idx.length === 1 && p.idx[0] === i && rectsEqual(p.r, slots[i]))
    if (!ok) return fail(`第 ${i + 1} 张照片未被切割线独立分出`, cuts.length)
  }
  return { ok: true, reason: '全部切割线贯通', failedStep: 0, pieces }
}

export interface SheetCutPlan {
  cuts: CutLine[]
  rawCuts: CutLine[]
  validation: ValidateResult
  pieces: Piece[]
}

/** 生成一张相纸的切割方案：递归二分 -> 共边合并 -> 逐步校验 */
export function planSheetCuts(region: Rect, slots: Rect[]): SheetCutPlan {
  const raw = decompose(region, slots) ?? []
  const rawValidation = validateCutSequence(region, slots, raw)
  const merged = mergeCollinearCuts(raw)
  const mergedValidation = validateCutSequence(region, slots, merged)
  const useMerged = mergedValidation.ok && merged.length < raw.length
  const validation = useMerged ? mergedValidation : rawValidation
  const cuts = useMerged ? merged : raw
  return {
    cuts,
    rawCuts: raw,
    validation,
    pieces: (useMerged ? mergedValidation : rawValidation).pieces,
  }
}

/** 转成 CutStep；merged = 该线由多段共边切割合并而来 */
export function toCutSteps(sheetIndex: number, cuts: CutLine[], rawCuts: CutLine[]): CutStep[] {
  return cuts.map((c) => {
    const covered = rawCuts.filter(
      (r) =>
        r.axis === c.axis &&
        Math.abs(r.at - c.at) < EPS &&
        r.from >= c.from - EPS &&
        r.to <= c.to + EPS,
    ).length
    return {
      sheetIndex,
      axis: c.axis,
      at: c.at,
      from: c.from,
      to: c.to,
      merged: covered > 1,
    }
  })
}
