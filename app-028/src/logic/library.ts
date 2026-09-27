/** 尺寸库查询与任务 -> 排样输入 的转换 */
import papersJson from '../data/papers.json'
import type { PackGroup, PackOptions } from './packer'
import type { Item, Paper, PaperTemplate, PhotoSize, Task } from './types'

export const BUILTIN_PAPERS: Paper[] = papersJson.papers as Paper[]
export const BUILTIN_PHOTO_SIZES: PhotoSize[] = papersJson.photoSizes as PhotoSize[]
export const BUILTIN_TEMPLATES: PaperTemplate[] = papersJson.templates as PaperTemplate[]

export function findPaper(all: Paper[], id: string): Paper | undefined {
  return all.find((p) => p.id === id)
}

export function findPhotoSize(all: PhotoSize[], id: string): PhotoSize | undefined {
  return all.find((s) => s.id === id)
}

export function resolvePaper(task: Task, all: Paper[]): Paper {
  if (task.paperId === 'custom' && task.customPaper) return task.customPaper
  return findPaper(all, task.paperId) ?? all[0]
}

export function sizeLabel(size: PhotoSize | undefined): string {
  if (!size) return '未知尺寸'
  return `${size.name} ${size.wMm}×${size.hMm}mm`
}

export function itemLabel(item: Item, sizes: PhotoSize[]): string {
  const s = findPhotoSize(sizes, item.sizeId)
  return s ? s.name : '自定义'
}

/** 任务 -> 排样器输入 */
export function groupsFromTask(task: Task, sizes: PhotoSize[]): PackGroup[] {
  const out: PackGroup[] = []
  for (const item of task.items) {
    const s = findPhotoSize(sizes, item.sizeId)
    if (!s || item.qty <= 0) continue
    out.push({
      itemId: item.id,
      copies: item.qty,
      photoW: s.wMm,
      photoH: s.hMm,
      allowRotate: item.rotateAllowed,
      keepTogether: item.keepTogether,
    })
  }
  return out
}

export function optionsFromTask(task: Task, paper: Paper): PackOptions {
  return {
    paperW: paper.wMm,
    paperH: paper.hMm,
    marginMm: paper.marginMm,
    safeEdgeMm: task.safeEdgeMm,
    gapMm: task.gapMm,
    kerfMm: task.kerfMm,
    allowRotate: task.allowRotate,
  }
}

export function totalPhotoCount(task: Task): number {
  return task.items.reduce((acc, i) => acc + Math.max(0, i.qty), 0)
}

export function newId(prefix = 'id'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rnd}`
}
