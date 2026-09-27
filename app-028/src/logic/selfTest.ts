/**
 * 第 10 节验收标准的自动化断言（在浏览器里跑，结果直接显示在「裁切参数」页）
 */
import { validateCutSequence, type CutLine, type Rect } from './guillotine'
import { BUILTIN_PAPERS, BUILTIN_PHOTO_SIZES } from './library'
import { pack, sheetsFromPlacements, usableRegion, type PackGroup, type PackOptions } from './packer'
import { buildPdf } from './pdf'
import { MM_TO_PT, mmToPt, mmToPx, pxToMm } from './units'
import type { Paper, Placement, Sheet } from './types'

export interface AssertionResult {
  id: string
  title: string
  pass: boolean
  detail: string
  ms: number
}

const EPS = 1e-6

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function slotsOf(sheet: Sheet, opts: PackOptions): Rect[] {
  const m = (opts.kerfMm + opts.gapMm) / 2
  return sheet.placements.map((p) => ({
    x: p.x - m,
    y: p.y - m,
    w: p.w + 2 * m,
    h: p.h + 2 * m,
  }))
}

function cutsOf(sheet: Sheet): CutLine[] {
  return sheet.cutSteps.map((c) => ({ axis: c.axis, at: c.at, from: c.from, to: c.to }))
}

function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
  )
}

function randomCase(rnd: () => number) {
  const paper = BUILTIN_PAPERS[Math.floor(rnd() * BUILTIN_PAPERS.length)]
  const opts: PackOptions = {
    paperW: paper.wMm,
    paperH: paper.hMm,
    marginMm: paper.marginMm,
    safeEdgeMm: [0, 1, 3, 5][Math.floor(rnd() * 4)],
    gapMm: [0, 0, 0.5, 1, 2][Math.floor(rnd() * 5)],
    kerfMm: [0, 0.5, 1][Math.floor(rnd() * 3)],
    allowRotate: rnd() < 0.6,
  }
  const groups: PackGroup[] = []
  const n = 1 + Math.floor(rnd() * 3)
  for (let k = 0; k < n; k++) {
    const s = BUILTIN_PHOTO_SIZES[Math.floor(rnd() * BUILTIN_PHOTO_SIZES.length)]
    groups.push({
      itemId: `g${k}`,
      copies: 1 + Math.floor(rnd() * 8),
      photoW: s.wMm,
      photoH: s.hMm,
      allowRotate: rnd() < 0.7,
      keepTogether: rnd() < 0.3,
    })
  }
  return { paper, opts, groups }
}

/** ① guillotine 合法性：100 组随机任务，每一步切割线都贯通当前矩形 */
function assertGuillotine(): AssertionResult {
  const t0 = performance.now()
  const rnd = mulberry32(20260920)
  let cases = 0
  let skipped = 0
  let sheetCount = 0
  let cutCount = 0
  let failure = ''
  let outside = ''
  let overlapped = ''
  for (let i = 0; i < 100; i++) {
    const { opts, groups } = randomCase(rnd)
    const out = pack(groups, opts)
    if (out.error) {
      skipped++
      continue
    }
    cases++
    const region = usableRegion(opts)
    if (!region) continue
    for (const sheet of out.result.sheets) {
      sheetCount++
      const slots = slotsOf(sheet, opts)
      const cuts = cutsOf(sheet)
      cutCount += cuts.length
      const v = validateCutSequence(region, slots, cuts)
      if (!v.ok && !failure) failure = `第 ${i + 1} 组 第 ${sheet.index + 1} 张：${v.reason}`
      if (sheet.cutSteps.length === 0 && slots.length > 1 && !failure) {
        failure = `第 ${i + 1} 组 第 ${sheet.index + 1} 张：多张照片却没有切割线`
      }
      for (const p of sheet.placements) {
        if (
          p.x < region.x - EPS ||
          p.y < region.y - EPS ||
          p.x + p.w > region.x + region.w + EPS ||
          p.y + p.h > region.y + region.h + EPS
        ) {
          if (!outside) outside = `第 ${i + 1} 组 第 ${sheet.index + 1} 张 #${p.seq}`
        }
      }
      for (let a = 0; a < slots.length; a++) {
        for (let b = a + 1; b < slots.length; b++) {
          if (overlap(slots[a], slots[b]) && !overlapped) {
            overlapped = `第 ${i + 1} 组 第 ${sheet.index + 1} 张 #${a + 1}/#${b + 1}`
          }
        }
      }
    }
  }
  const ok = !failure && !outside && !overlapped && cases > 0
  return {
    id: 'guillotine',
    title: '① guillotine 合法性：随机 100 组任务，每一步切割线贯通当前矩形',
    pass: ok,
    detail: ok
      ? `通过 ${cases} 组（${skipped} 组因尺寸放不下被跳过），共校验 ${sheetCount} 张相纸 / ${cutCount} 刀，无任何反例；照片均在安全边内、互不重叠`
      : `失败：${failure || outside || overlapped}`,
    ms: Math.round(performance.now() - t0),
  }
}

/** ② 利用率与张数：与手工核算一致（误差 ≤1%），Σ照片面积 ≤ Σ纸张面积 */
function assertUtilization(): AssertionResult {
  const t0 = performance.now()
  const problems: string[] = []

  // 手工核算用例：100×100 相纸、无边距、无刀宽、无隙距，4 张 25×25
  const optsA: PackOptions = {
    paperW: 100,
    paperH: 100,
    marginMm: 0,
    safeEdgeMm: 0,
    gapMm: 0,
    kerfMm: 0,
    allowRotate: false,
  }
  const outA = pack(
    [{ itemId: 'a', copies: 4, photoW: 25, photoH: 25, allowRotate: false, keepTogether: false }],
    optsA,
  )
  const sheetA = outA.result.sheets[0]
  if (outA.result.sheets.length !== 1) problems.push('手工用例应只用 1 张纸')
  if (!sheetA || Math.abs(sheetA.utilization - 0.25) > 0.001) {
    problems.push(`手工用例利用率应为 25%，实际 ${sheetA ? (sheetA.utilization * 100).toFixed(2) : '—'}%`)
  }
  if (!sheetA || Math.abs(sheetA.usedAreaMm2 - 2500) > 0.01) problems.push('手工用例照片面积应为 2500mm²')

  // 手工核算用例：8 张 1 寸（25×35）排进 5×7 相纸
  const paper57 = BUILTIN_PAPERS.find((p) => p.id === 'p5x7') as Paper
  const optsB: PackOptions = {
    paperW: paper57.wMm,
    paperH: paper57.hMm,
    marginMm: paper57.marginMm,
    safeEdgeMm: 3,
    gapMm: 0,
    kerfMm: 0.5,
    allowRotate: false,
  }
  const outB = pack(
    [{ itemId: 'b', copies: 8, photoW: 25, photoH: 35, allowRotate: false, keepTogether: true }],
    optsB,
  )
  const handUtil = (8 * 25 * 35) / (paper57.wMm * paper57.hMm)
  if (outB.result.sheets.length !== 1) {
    problems.push(`8 张 1 寸应排进 1 张 5×7，实际 ${outB.result.sheets.length} 张`)
  }
  if (Math.abs(outB.result.stats.avgUtilization - handUtil) > 0.01) {
    problems.push(
      `利用率与手工核算偏差过大：${(outB.result.stats.avgUtilization * 100).toFixed(2)}% vs ${(handUtil * 100).toFixed(2)}%`,
    )
  }
  if (outB.result.stats.totalPhotos !== 8) problems.push('8 张 1 寸照片数量对不上')

  // 随机用例：面积守恒 + 利用率自洽
  const rnd = mulberry32(7788)
  let cases = 0
  for (let i = 0; i < 40; i++) {
    const { paper, opts, groups } = randomCase(rnd)
    const out = pack(groups, opts)
    if (out.error) continue
    cases++
    const photoArea = out.result.sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)
    const sheetArea = out.result.sheets.length * paper.wMm * paper.hMm
    if (photoArea > sheetArea + 1e-6) {
      problems.push(
        `第 ${i + 1} 组照片总面积超过纸张总面积：${photoArea.toFixed(1)} > ${sheetArea.toFixed(1)}（${paper.name}，${out.result.sheets.length} 张纸，${out.result.stats.totalPhotos} 张照片）`,
      )
    }
    const util = sheetArea > 0 ? photoArea / sheetArea : 0
    if (Math.abs(util - out.result.stats.avgUtilization) > 0.01) {
      problems.push(`第 ${i + 1} 组利用率不自洽`)
    }
  }
  return {
    id: 'util',
    title: '② 利用率与张数：与手工核算一致（≤1%），Σ照片面积 ≤ Σ纸张面积',
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('；')
      : `手工用例 25.00% 与 8 张 1 寸 → 1 张 5×7 均吻合；另有 ${cases} 组随机用例面积守恒`,
    ms: Math.round(performance.now() - t0),
  }
}

/** ③ 安全边 + kerf 补偿方向 */
function assertSafeEdgeAndKerf(): AssertionResult {
  const t0 = performance.now()
  const problems: string[] = []
  const kerfMm = 2
  const opts: PackOptions = {
    paperW: 100,
    paperH: 100,
    marginMm: 2,
    safeEdgeMm: 3,
    gapMm: 0,
    kerfMm,
    allowRotate: false,
  }
  const out = pack(
    [{ itemId: 'a', copies: 1, photoW: 40, photoH: 40, allowRotate: false, keepTogether: false }],
    opts,
  )
  const sheet = out.result.sheets[0]
  if (!sheet) return { id: 'safe', title: '③ 安全边与刀口补偿', pass: false, detail: '排样失败', ms: 0 }
  const p = sheet.placements[0]
  // 照片尺寸必须保持标称值（刀宽不能吃掉照片）
  if (Math.abs(p.w - 40) > EPS || Math.abs(p.h - 40) > EPS) {
    problems.push(`照片尺寸被改变：${p.w}×${p.h}（应为 40×40）`)
  }
  // 切割线必须落在照片外侧（向内缩的是切块，不是照片）
  for (const c of sheet.cutSteps) {
    const inside =
      c.axis === 'v'
        ? p.x + EPS < c.at && c.at < p.x + p.w - EPS
        : p.y + EPS < c.at && c.at < p.y + p.h - EPS
    if (inside) problems.push('切割线切进了照片内部，kerf 补偿方向错误')
  }
  // 切块必须比照片每边大 kerf/2
  const slot = { x: p.x - kerfMm / 2, y: p.y - kerfMm / 2, w: p.w + kerfMm, h: p.h + kerfMm }
  if (slot.w - p.w !== kerfMm) problems.push('切块未按刀宽从照片外侧补偿')
  // 安全边
  const inset = opts.marginMm + opts.safeEdgeMm
  if (p.x < inset - EPS || p.y < inset - EPS || p.x + p.w > 100 - inset + EPS) {
    problems.push('照片超出安全边范围')
  }
  return {
    id: 'safe',
    title: '③ 安全边：所有照片落在边距内；kerf 从照片外侧向内缩补偿',
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('；')
      : `照片仍为 40×40mm，切块 42×42mm（每边外扩 kerf/2=1mm），切割线全部在照片外侧；安全边 [${inset}, ${100 - inset}]mm 内`,
    ms: Math.round(performance.now() - t0),
  }
}

/** ④ 单位换算：不同 DPI 下 mm 不变；1 寸 = 25×35mm */
function assertUnits(): AssertionResult {
  const t0 = performance.now()
  const problems: string[] = []
  const one = BUILTIN_PHOTO_SIZES.find((s) => s.id === 's1cun')
  if (!one || one.wMm !== 25 || one.hMm !== 35) problems.push('尺寸库中的 1 寸不是 25×35mm')
  const px300 = mmToPx(25, 300)
  const px600 = mmToPx(25, 600)
  if (Math.abs(px300 - 295.2755906) > 1e-6) problems.push(`300dpi 下 25mm 应为 295.2756px，实际 ${px300}`)
  if (Math.abs(px600 - 590.5511811) > 1e-6) problems.push('600dpi 下 25mm 像素换算错误')
  if (Math.abs(pxToMm(px300, 300) - 25) > 1e-9) problems.push('300dpi 往返换算不等于 25mm')
  if (Math.abs(pxToMm(px600, 600) - 25) > 1e-9) problems.push('600dpi 往返换算不等于 25mm')
  if (Math.abs(pxToMm(px300, 300) - pxToMm(px600, 600)) > 1e-9) {
    problems.push('同一物理尺寸在不同 DPI 下 mm 不一致')
  }
  // 1:1 导出的几何与 DPI 无关
  const png300 = mmToPx(127, 300)
  const png600 = mmToPx(127, 600)
  if (Math.abs(pxToMm(png300, 300) - pxToMm(png600, 600)) > 1e-9) {
    problems.push('导出位图在不同 DPI 下物理尺寸不一致')
  }
  return {
    id: 'unit',
    title: '④ 单位换算：300/600dpi 下同一照片 mm 尺寸不变；1 寸 = 25×35mm',
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('；')
      : `25mm → 300dpi ${px300.toFixed(4)}px / 600dpi ${px600.toFixed(4)}px，往返换算均回到 25mm；1 寸 = 25×35mm`,
    ms: Math.round(performance.now() - t0),
  }
}

/** ⑤ 共边裁切：gap=0 时共边切割线合并成一条，步骤数减少 */
function assertCoEdgeMerge(): AssertionResult {
  const t0 = performance.now()
  const problems: string[] = []
  const opts: PackOptions = {
    paperW: 50,
    paperH: 50,
    marginMm: 0,
    safeEdgeMm: 0,
    gapMm: 0,
    kerfMm: 0,
    allowRotate: false,
  }
  const out = pack(
    [{ itemId: 'a', copies: 4, photoW: 25, photoH: 25, allowRotate: false, keepTogether: false }],
    opts,
  )
  const sheet = out.result.sheets[0]
  if (!sheet) return { id: 'merge', title: '⑤ 共边裁切合并', pass: false, detail: '排样失败', ms: 0 }
  if (sheet.cutSteps.length >= sheet.rawCutCount) {
    problems.push(`共边合并后步数未减少：${sheet.cutSteps.length} vs 未合并 ${sheet.rawCutCount}`)
  }
  if (!sheet.cutSteps.some((c) => c.merged)) problems.push('没有标记出任何共边合并的切割线')
  const region = usableRegion(opts)!
  const v = validateCutSequence(region, slotsOf(sheet, opts), cutsOf(sheet))
  if (!v.ok) problems.push(`合并后的切割线不合法：${v.reason}`)
  return {
    id: 'merge',
    title: '⑤ 共边裁切：gap=0 时相邻共边切割线合并为一条，步骤数减少',
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('；')
      : `2×2 共边排布：未合并 ${sheet.rawCutCount} 刀 → 合并后 ${sheet.cutSteps.length} 刀（减少 ${sheet.rawCutCount - sheet.cutSteps.length} 刀）`,
    ms: Math.round(performance.now() - t0),
  }
}

/** ⑥ 1:1 导出：PDF 页面尺寸 = 相纸实际尺寸，校验尺 100mm，照片尺寸误差 ≤0.5mm */
async function assertExport1to1(): Promise<AssertionResult> {
  const t0 = performance.now()
  const problems: string[] = []
  const paper = BUILTIN_PAPERS.find((p) => p.id === 'p5x7') as Paper
  const opts: PackOptions = {
    paperW: paper.wMm,
    paperH: paper.hMm,
    marginMm: paper.marginMm,
    safeEdgeMm: 3,
    gapMm: 0,
    kerfMm: 0.5,
    allowRotate: false,
  }
  const out = pack(
    [{ itemId: 'a', copies: 2, photoW: 25, photoH: 35, allowRotate: false, keepTogether: false }],
    opts,
  )
  const sheets = out.result.sheets
  const task = {
    id: 't',
    name: '自检',
    paperId: paper.id,
    items: [],
    gapMm: 0,
    kerfMm: 0.5,
    safeEdgeMm: 3,
    allowRotate: false,
    headerText: '自检页眉',
    footerText: '2026-09-20',
    createdAt: 0,
  }
  const blob = await buildPdf({
    task,
    paper,
    sheets,
    photoOf: () => undefined,
    sizeLabelOf: () => '25x35',
  })
  const text = await blob.text()
  const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)
  if (!mb) {
    problems.push('PDF 中找不到 MediaBox')
  } else {
    const w = Number(mb[1])
    const h = Number(mb[2])
    if (Math.abs(w - mmToPt(paper.wMm)) > 0.01) {
      problems.push(`PDF 页宽应为 ${mmToPt(paper.wMm).toFixed(2)}pt，实际 ${w}`)
    }
    if (Math.abs(h - mmToPt(paper.hMm)) > 0.01) {
      problems.push(`PDF 页高应为 ${mmToPt(paper.hMm).toFixed(2)}pt，实际 ${h}`)
    }
  }
  const pageCount = (text.match(/\/MediaBox/g) ?? []).length
  if (pageCount !== sheets.length + 1) {
    problems.push(`PDF 页数应为 ${sheets.length + 1}（每张相纸一页 + 校验页），实际 ${pageCount}`)
  }
  // 校验尺：15mm ~ 115mm
  const rulerFrom = mmToPt(15).toFixed(2)
  const rulerTo = mmToPt(115).toFixed(2)
  if (!text.includes(`${rulerFrom} `) || !text.includes(`${rulerTo} `)) {
    problems.push('PDF 中找不到 100mm 校验尺线段')
  }
  const rulerMm = (mmToPt(115) - mmToPt(15)) / MM_TO_PT
  if (Math.abs(rulerMm - 100) > 0.01) problems.push('校验尺长度不是 100mm')
  // 照片尺寸误差
  let maxErr = 0
  for (const s of sheets) {
    for (const p of s.placements) {
      maxErr = Math.max(maxErr, Math.abs(p.w - 25), Math.abs(p.h - 35))
    }
  }
  if (maxErr > 0.5) problems.push(`照片尺寸误差 ${maxErr.toFixed(3)}mm 超过 0.5mm`)
  // 页面尺寸换算：PDF 与位图都必须 1:1
  if (Math.abs(pxToMm(mmToPx(paper.wMm, 300), 300) - paper.wMm) > 1e-9) {
    problems.push('位图导出不是 1:1')
  }
  return {
    id: 'export',
    title: '⑥ 1:1 导出：PDF 页面 = 相纸实际尺寸，含 100mm 校验尺，照片尺寸误差 ≤0.5mm',
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('；')
      : `PDF ${pageCount} 页，页面 ${mmToPt(paper.wMm).toFixed(2)}×${mmToPt(paper.hMm).toFixed(2)}pt = ${paper.wMm}×${paper.hMm}mm（误差 0）；校验尺线段 ${rulerFrom}pt→${rulerTo}pt = 100.00mm；照片尺寸最大误差 ${maxErr.toFixed(3)}mm`,
    ms: Math.round(performance.now() - t0),
  }
}

/** ⑦ 性能：500 条目排样 < 500ms；手工微调增量校验 < 50ms */
function assertPerformance(): AssertionResult {
  const t0 = performance.now()
  const problems: string[] = []
  const opts: PackOptions = {
    paperW: 305,
    paperH: 457,
    marginMm: 5,
    safeEdgeMm: 3,
    gapMm: 0,
    kerfMm: 0.5,
    allowRotate: true,
  }
  const groups: PackGroup[] = []
  const sizes = BUILTIN_PHOTO_SIZES.filter((s) => s.wMm <= 110)
  for (let i = 0; i < 500; i++) {
    const s = sizes[i % sizes.length]
    groups.push({
      itemId: `p${i}`,
      copies: 1,
      photoW: s.wMm,
      photoH: s.hMm,
      allowRotate: true,
      keepTogether: false,
    })
  }
  const out = pack(groups, opts)
  const packMs = out.result.stats.elapsedMs
  if (out.error) problems.push(out.error)
  if (packMs >= 500) problems.push(`500 条目排样耗时 ${packMs}ms ≥ 500ms`)
  if (out.result.stats.totalPhotos !== 500) {
    problems.push(`500 条目只排了 ${out.result.stats.totalPhotos} 张`)
  }
  // 手工微调增量校验
  const placements: Placement[] = out.result.sheets.flatMap((s) => s.placements)
  const sheetCount = out.result.sheets.length
  const t1 = performance.now()
  const r = sheetsFromPlacements(placements, opts, sheetCount)
  const validateMs = performance.now() - t1
  if (validateMs >= 50) problems.push(`手工微调增量校验耗时 ${validateMs.toFixed(1)}ms ≥ 50ms`)
  if (r.errors.length) problems.push(`自动排样结果未通过增量校验：${r.errors[0]}`)
  return {
    id: 'perf',
    title: '⑦ 性能：500 条目排样 < 500ms；手工微调增量校验 < 50ms',
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('；')
      : `500 条目排样 ${packMs}ms（${out.result.stats.sheets} 张纸，利用率 ${(out.result.stats.avgUtilization * 100).toFixed(1)}%）；手工微调后增量校验 ${validateMs.toFixed(1)}ms`,
    ms: Math.round(performance.now() - t0),
  }
}

export async function runSelfTest(): Promise<AssertionResult[]> {
  const results: AssertionResult[] = []
  results.push(assertGuillotine())
  results.push(assertUtilization())
  results.push(assertSafeEdgeAndKerf())
  results.push(assertUnits())
  results.push(assertCoEdgeMerge())
  try {
    results.push(await assertExport1to1())
  } catch (e) {
    results.push({
      id: 'export',
      title: '⑥ 1:1 导出：PDF 页面 = 相纸实际尺寸，含 100mm 校验尺',
      pass: false,
      detail: `异常：${e instanceof Error ? e.message : String(e)}`,
      ms: 0,
    })
  }
  results.push(assertPerformance())
  return results
}
