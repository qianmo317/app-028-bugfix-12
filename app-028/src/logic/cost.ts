/** 成本核算与「换纸试算」 */
import { pack, type PackGroup, type PackOptions } from './packer'
import { round } from './units'
import type { CostReport, PackResult, Paper } from './types'

export function computeCost(paper: Paper, result: PackResult): CostReport {
  const sheets = result.sheets.length
  const totalPhotoCount = result.stats.totalPhotos
  const totalCents = sheets * paper.priceCents
  const perPhotoCents = totalPhotoCount > 0 ? totalCents / totalPhotoCount : 0
  const usedArea = result.sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)
  const totalSheetArea = sheets * paper.wMm * paper.hMm
  const wasteRate = totalSheetArea > 0 ? 1 - usedArea / totalSheetArea : 0
  // 不排样：每张照片单独用一整张相纸
  const naiveTotalCents = totalPhotoCount * paper.priceCents
  const naiveArea = totalPhotoCount * paper.wMm * paper.hMm
  const naiveWasteRate = naiveArea > 0 ? 1 - usedArea / naiveArea : 0
  return {
    paperName: paper.name,
    sheets,
    totalCents,
    perPhotoCents: round(perPhotoCents, 2),
    totalPhotoCount,
    wasteRate,
    naiveWasteRate,
    naiveTotalCents,
    savedCents: naiveTotalCents - totalCents,
  }
}

export interface PaperCompare {
  paper: Paper
  sheets: number
  avgUtilization: number
  totalCents: number
  perPhotoCents: number
  error?: string
}

/** 利用率偏低时自动试算 2~3 种其它相纸规格做对比 */
export function comparePapers(
  groups: PackGroup[],
  opts: Omit<PackOptions, 'paperW' | 'paperH' | 'marginMm'>,
  papers: Paper[],
  currentPaperId: string,
  limit = 3,
): PaperCompare[] {
  const out: PaperCompare[] = []
  for (const p of papers) {
    if (p.id === currentPaperId) continue
    if (p.kind === 'roll') continue
    const r = pack(groups, { ...opts, paperW: p.wMm, paperH: p.hMm, marginMm: p.marginMm })
    if (r.error) {
      out.push({
        paper: p,
        sheets: 0,
        avgUtilization: 0,
        totalCents: 0,
        perPhotoCents: 0,
        error: r.error,
      })
      continue
    }
    const cost = computeCost(p, r.result)
    out.push({
      paper: p,
      sheets: cost.sheets,
      avgUtilization: r.result.stats.avgUtilization,
      totalCents: cost.totalCents,
      perPhotoCents: cost.perPhotoCents,
    })
  }
  return out
    .filter((c) => !c.error)
    .sort((a, b) => a.totalCents - b.totalCents || b.avgUtilization - a.avgUtilization)
    .slice(0, limit)
}
