/**
 * 排样器：guillotine 约束下的 2D 装箱。
 * 空闲矩形用「整边切分（guillotine split）」维护，任何一次放置都只把剩余区域
 * 沿一条整边切成两个子矩形，因此结果天然满足「每一刀都能直线裁到底」。
 */
import { EPS, planSheetCuts, toCutSteps, type Rect } from './guillotine'
import { round } from './units'
import type { PackResult, PackStats, Placement, Sheet, WasteRect } from './types'

export interface PackGroup {
  itemId: string
  copies: number
  photoW: number
  photoH: number
  allowRotate: boolean
  keepTogether: boolean
}

export interface PackOptions {
  paperW: number
  paperH: number
  marginMm: number
  safeEdgeMm: number
  gapMm: number
  kerfMm: number
  allowRotate: boolean
}

export interface PackOutput {
  result: PackResult
  error?: string
}

interface PlacedRaw {
  itemId: string
  rect: Rect
  rotated: boolean
}

export function usableRegion(opts: PackOptions): Rect | null {
  const inset = opts.marginMm + opts.safeEdgeMm
  const w = round(opts.paperW - 2 * inset, 4)
  const h = round(opts.paperH - 2 * inset, 4)
  if (w <= 0 || h <= 0) return null
  return { x: inset, y: inset, w, h }
}

export function emptyResult(elapsedMs = 0): PackResult {
  const stats: PackStats = {
    totalPhotos: 0,
    sheets: 0,
    avgUtilization: 0,
    elapsedMs,
    keepTogetherBroken: [],
  }
  return { sheets: [], stats }
}

/** 由一组（可能被手工微调过的）照片矩形重建每张相纸的切割步骤与利用率 */
export function sheetsFromPlacements(
  placements: Placement[],
  opts: PackOptions,
  sheetCount: number,
): { sheets: Sheet[]; errors: string[] } {
  const errors: string[] = []
  const region = usableRegion(opts)
  if (!region) return { sheets: [], errors: ['纸边留白 + 四周安全边 已超过相纸尺寸'] }
  const m = (opts.kerfMm + opts.gapMm) / 2
  const sheets: Sheet[] = []
  for (let s = 0; s < sheetCount; s++) {
    const list = placements
      .filter((p) => p.sheetIndex === s)
      .slice()
      .sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x))
    const slots: Rect[] = list.map((p) => ({
      x: p.x - m,
      y: p.y - m,
      w: p.w + 2 * m,
      h: p.h + 2 * m,
    }))
    // 越界检查（安全边）
    for (const p of list) {
      if (
        p.x < region.x - EPS ||
        p.y < region.y - EPS ||
        p.x + p.w > region.x + region.w + EPS ||
        p.y + p.h > region.y + region.h + EPS
      ) {
        errors.push(`第 ${s + 1} 张纸上的第 ${p.seq} 号照片超出了安全边范围`)
      }
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]
        const b = slots[j]
        if (
          a.x < b.x + b.w - EPS &&
          b.x < a.x + a.w - EPS &&
          a.y < b.y + b.h - EPS &&
          b.y < a.y + a.h - EPS
        ) {
          errors.push(`第 ${s + 1} 张纸上的照片互相重叠`)
          i = slots.length
          break
        }
      }
    }
    const plan = planSheetCuts(region, slots)
    if (!plan.validation.ok) {
      errors.push(`第 ${s + 1} 张纸不满足 guillotine 贯通裁切：${plan.validation.reason}`)
    }
    const cutSteps = toCutSteps(s, plan.cuts, plan.rawCuts)
    const usedAreaMm2 = list.reduce((acc, p) => acc + p.w * p.h, 0)
    const sheetAreaMm2 = opts.paperW * opts.paperH
    const wasteRects: WasteRect[] = plan.pieces
      .filter((pc) => pc.idx.length === 0 && pc.r.w >= 8 && pc.r.h >= 8)
      .map((pc) => ({
        x: round(pc.r.x, 3),
        y: round(pc.r.y, 3),
        w: round(pc.r.w, 3),
        h: round(pc.r.h, 3),
      }))
    sheets.push({
      index: s,
      placements: list,
      cutSteps,
      rawCutCount: plan.rawCuts.length,
      usedAreaMm2: round(usedAreaMm2, 3),
      sheetAreaMm2,
      utilization: sheetAreaMm2 > 0 ? usedAreaMm2 / sheetAreaMm2 : 0,
      wasteRects,
    })
  }
  return { sheets, errors }
}

interface Fit {
  idx: number
  rotated: boolean
  w: number
  h: number
}

/** 放置适配判断用的极小容差（1 纳米级），只吸收浮点噪声 */
const FIT_EPS = 1e-6

function findBest(free: Rect[], w: number, h: number, allowRotate: boolean): Fit | null {
  let best: Fit | null = null
  let bestScore: number[] | null = null
  const consider = (
    i: number,
    rectW: number,
    rectH: number,
    pw: number,
    ph: number,
    rot: boolean,
  ) => {
    if (pw > rectW + FIT_EPS || ph > rectH + FIT_EPS) return
    const dw = rectW - pw
    const dh = rectH - ph
    const score = [Math.min(dw, dh), Math.max(dw, dh), rectW * rectH - pw * ph]
    if (
      !bestScore ||
      score[0] < bestScore[0] - EPS ||
      (Math.abs(score[0] - bestScore[0]) < EPS &&
        (score[1] < bestScore[1] - EPS ||
          (Math.abs(score[1] - bestScore[1]) < EPS && score[2] < bestScore[2] - EPS)))
    ) {
      bestScore = score
      best = { idx: i, rotated: rot, w: pw, h: ph }
    }
  }
  for (let i = 0; i < free.length; i++) {
    const f = free[i]
    consider(i, f.w, f.h, w, h, false)
    if (allowRotate && Math.abs(w - h) > EPS) consider(i, f.w, f.h, h, w, true)
  }
  return best
}

/** 在空闲矩形内放置 pw×ph，并按整边切分剩余区域 */
function splitPlace(free: Rect[], idx: number, pw: number, ph: number): Rect {
  const f = free[idx]
  free.splice(idx, 1)
  const placed: Rect = { x: f.x, y: f.y, w: pw, h: ph }
  const dw = f.w - pw
  const dh = f.h - ph
  if (dh <= EPS && dw <= EPS) return placed
  if (dh <= EPS) {
    free.push({ x: f.x + pw, y: f.y, w: dw, h: ph })
    return placed
  }
  if (dw <= EPS) {
    free.push({ x: f.x, y: f.y + ph, w: f.w, h: dh })
    return placed
  }
  const maxH = Math.max(f.w * dh, dw * ph)
  const maxV = Math.max(dw * f.h, pw * dh)
  if (maxH >= maxV) {
    free.push({ x: f.x, y: f.y + ph, w: f.w, h: dh })
    free.push({ x: f.x + pw, y: f.y, w: dw, h: ph })
  } else {
    free.push({ x: f.x + pw, y: f.y, w: dw, h: f.h })
    free.push({ x: f.x, y: f.y + ph, w: pw, h: dh })
  }
  return placed
}

interface Trial {
  free: Rect[]
  placed: Rect
  rotated: boolean
}

function tryPlaceOne(free: Rect[], g: PackGroup, opts: PackOptions, m: number): Trial | null {
  const sw = g.photoW + 2 * m
  const sh = g.photoH + 2 * m
  const fit = findBest(free, sw, sh, opts.allowRotate && g.allowRotate)
  if (!fit) return null
  const trial = free.slice()
  const placed = splitPlace(trial, fit.idx, fit.w, fit.h)
  return { free: trial, placed, rotated: fit.rotated }
}

function tryPlaceMany(
  free: Rect[],
  g: PackGroup,
  count: number,
  opts: PackOptions,
  m: number,
): Trial[] | null {
  let cur = free
  const out: Trial[] = []
  for (let i = 0; i < count; i++) {
    const t = tryPlaceOne(cur, g, opts, m)
    if (!t) return null
    out.push(t)
    cur = t.free
  }
  return out
}

export function pack(groups: PackGroup[], opts: PackOptions): PackOutput {
  const started = performance.now()
  const region = usableRegion(opts)
  if (!region) {
    return {
      error: '纸边留白 + 四周安全边 已超过相纸尺寸，请调小裁切参数',
      result: emptyResult(performance.now() - started),
    }
  }
  const m = (opts.kerfMm + opts.gapMm) / 2

  const queue: PackGroup[] = groups
    .filter((g) => g.copies > 0)
    .map((g) => ({ ...g }))
    .sort((a, b) => {
      const ma = Math.max(a.photoW, a.photoH)
      const mb = Math.max(b.photoW, b.photoH)
      if (Math.abs(ma - mb) > EPS) return mb - ma
      return b.photoW * b.photoH - a.photoW * a.photoH
    })

  // 单张都放不下 -> 直接给出边界提示
  const oversize: string[] = []
  for (const g of queue) {
    const sw = g.photoW + 2 * m
    const sh = g.photoH + 2 * m
    const canRot = opts.allowRotate && g.allowRotate
    const ok =
      (sw <= region.w + EPS && sh <= region.h + EPS) ||
      (canRot && sh <= region.w + EPS && sw <= region.h + EPS)
    if (!ok) {
      oversize.push(
        `${round(g.photoW, 1)}×${round(g.photoH, 1)}mm 放不进可用区 ${round(region.w, 1)}×${round(region.h, 1)}mm`,
      )
    }
  }
  if (oversize.length) {
    return {
      error: Array.from(new Set(oversize)).join('；') + '（可换更大的相纸，或调小安全边/纸边留白）',
      result: emptyResult(performance.now() - started),
    }
  }

  const rawSheets: Array<{ placements: PlacedRaw[] }> = []
  let guard = 0
  while (queue.some((g) => g.copies > 0) && guard++ < 20000) {
    let free: Rect[] = [{ ...region }]
    const placements: PlacedRaw[] = []

    const commit = (t: Trial, g: PackGroup) => {
      free = t.free
      placements.push({ itemId: g.itemId, rect: t.placed, rotated: t.rotated })
    }

    let progress = true
    while (progress) {
      progress = false
      // 不拆散：若该组能整组放进空纸、却放不进当前剩余空间，则结束当前纸另起一张
      if (placements.length > 0) {
        const blocked = queue.some(
          (g) =>
            g.copies > 1 &&
            g.keepTogether &&
            !tryPlaceMany(free, g, g.copies, opts, m) &&
            tryPlaceMany([{ ...region }], g, g.copies, opts, m) !== null,
        )
        if (blocked) break
      }
      for (const g of queue) {
        if (g.copies <= 1 || !g.keepTogether) continue
        const many = tryPlaceMany(free, g, g.copies, opts, m)
        if (many) {
          for (const t of many) commit(t, g)
          g.copies = 0
          progress = true
        }
      }
      for (const g of queue) {
        if (g.copies <= 0) continue
        let t = tryPlaceOne(free, g, opts, m)
        while (t) {
          commit(t, g)
          g.copies--
          progress = true
          if (g.copies <= 0) break
          t = tryPlaceOne(free, g, opts, m)
        }
      }
      if (free.length > 400) {
        free = free.filter((r) => r.w > 0.5 && r.h > 0.5)
      }
    }
    if (placements.length === 0) break
    rawSheets.push({ placements })
  }

  // 组装：按「从上到下、从左到右」编号
  const rawPlacements: Placement[] = []
  let seq = 0
  const sheetOfItem = new Map<string, Set<number>>()
  for (let s = 0; s < rawSheets.length; s++) {
    const raw = rawSheets[s]
    const ordered = raw.placements
      .slice()
      .sort((a, b) =>
        Math.abs(a.rect.y - b.rect.y) > 0.01 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x,
      )
    for (const p of ordered) {
      seq += 1
      // 排样器放置的是「切块」（照片 + 刀宽/隙距补偿），这里换算回照片实际矩形
      rawPlacements.push({
        itemId: p.itemId,
        sheetIndex: s,
        x: p.rect.x + m,
        y: p.rect.y + m,
        w: p.rect.w - 2 * m,
        h: p.rect.h - 2 * m,
        rotated: p.rotated,
        seq,
      })
      let set = sheetOfItem.get(p.itemId)
      if (!set) {
        set = new Set()
        sheetOfItem.set(p.itemId, set)
      }
      set.add(s)
    }
  }

  const { sheets } = sheetsFromPlacements(rawPlacements, opts, rawSheets.length)

  const keepTogetherBroken: string[] = []
  for (const g of groups) {
    if (!g.keepTogether || g.copies <= 1) continue
    const set = sheetOfItem.get(g.itemId)
    if (set && set.size > 1) keepTogetherBroken.push(g.itemId)
  }

  const totalPhotos = sheets.reduce((acc, s) => acc + s.placements.length, 0)
  const totalUsed = sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)
  const stats: PackStats = {
    totalPhotos,
    sheets: sheets.length,
    avgUtilization:
      totalUsed > 0 ? totalUsed / (sheets.length * opts.paperW * opts.paperH) : 0,
    elapsedMs: round(performance.now() - started, 2),
    keepTogetherBroken,
  }
  return { result: { sheets, stats } }
}
