/** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
import type { Paper, Sheet, Task } from './types'

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
}

export function csvBlob(rows: Array<Array<string | number>>): Blob {
  return new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
}

export function cutListRows(
  task: Task,
  paper: Paper,
  sheets: Sheet[],
  sizeLabelOf: (seq: number) => string,
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['相纸', `${paper.name} ${paper.wMm}x${paper.hMm}mm`],
    ['隙距 mm', task.gapMm],
    ['刀宽补偿 mm', task.kerfMm],
    ['安全边 mm', task.safeEdgeMm],
    ['相纸张数', sheets.length],
    [],
    ['相纸序号', '刀序', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm', '是否共边合并'],
  ]
  for (const s of sheets) {
    s.cutSteps.forEach((c, i) => {
      rows.push([
        s.index + 1,
        i + 1,
        c.axis === 'v' ? '竖切' : '横切',
        Math.round(c.at * 100) / 100,
        Math.round(c.from * 100) / 100,
        Math.round(c.to * 100) / 100,
        Math.round((c.to - c.from) * 100) / 100,
        c.merged ? '是' : '否',
      ])
    })
    rows.push([])
  }
  rows.push(['照片编号', '所在相纸', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转'])
  for (const s of sheets) {
    for (const p of s.placements) {
      rows.push([
        p.seq,
        s.index + 1,
        sizeLabelOf(p.seq),
        Math.round(p.x * 100) / 100,
        Math.round(p.y * 100) / 100,
        Math.round(p.w * 100) / 100,
        Math.round(p.h * 100) / 100,
        p.rotated ? '90°' : '无',
      ])
    }
  }
  return rows
}
