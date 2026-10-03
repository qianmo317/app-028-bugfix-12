/**
 * 手写 PDF 生成器（不依赖任何第三方库）
 * - 页面尺寸 = 相纸实际尺寸（mm -> pt），按 100% 打印即为 1:1
 * - 照片以 JPEG XObject 嵌入；中文说明以位图嵌入（PDF 内置西文字体无法显示中文）
 */
import { imageToJpeg, renderTextBlock, renderTextStrip, type RasterImage } from './image'
import { computeSheetMarks, RULER_LENGTH_MM, tickLabel } from './sheetMarks'
import { MM_TO_PT } from './units'
import type { Paper, Placement, Sheet, Task } from './types'

const S = MM_TO_PT

const n2 = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2))
const asciiOnly = (s: string) => s.replace(/[^\x20-\x7E]/g, '')
const hasNonAscii = (s: string) => /[^\x20-\x7E]/.test(s)
const pdfEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

export interface PdfPhotoRef {
  key: string
  url: string
}

export interface PdfBuildInput {
  task: Task
  paper: Paper
  sheets: Sheet[]
  photoOf: (p: Placement) => PdfPhotoRef | undefined
  sizeLabelOf: (p: Placement) => string
  maxPhotos?: number
  onProgress?: (msg: string) => void
}

interface PageImage {
  name: string
  raster: RasterImage
  xPt: number
  yPt: number
  wPt: number
  hPt: number
}

interface PageSpec {
  wMm: number
  hMm: number
  content: string
  images: PageImage[]
}

/** 粗略估算 Helvetica 文本宽度（用于居中/右对齐） */
const textW = (s: string, size: number) => s.length * size * 0.52

type TextAlign = 'l' | 'c' | 'r'

function text(x: number, y: number, s: string, size: number, bold = false, align: TextAlign = 'l') {
  const w = textW(s, size)
  const t = align === 'c' ? x - w / 2 : align === 'r' ? x - w : x
  return `BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${n2(t)} ${n2(y)} Td (${pdfEscape(s)}) Tj ET`
}

async function buildSheetPage(
  input: PdfBuildInput,
  sheet: Sheet,
  index: number,
  photoRasters: Map<string, RasterImage>,
): Promise<PageSpec> {
  const { paper } = input
  const W = paper.wMm
  const H = paper.hMm
  const px = (mm: number) => mm * S
  const py = (mm: number) => (H - mm) * S
  const head: string[] = []
  const body: string[] = []
  const images: PageImage[] = []
  let imgIdx = 0

  const addImage = (raster: RasterImage, xMm: number, yMm: number, wMm: number, hMm: number) => {
    imgIdx += 1
    const name = `Im${imgIdx}`
    images.push({
      name,
      raster,
      xPt: px(xMm),
      yPt: py(yMm + hMm),
      wPt: px(wMm),
      hPt: px(hMm),
    })
    head.push(
      `q ${n2(px(wMm))} 0 0 ${n2(px(hMm))} ${n2(px(xMm))} ${n2(py(yMm + hMm))} cm /${name} Do Q`,
    )
  }

  // 导出标注：刀序 / 纸边刻度 / 页眉落款全部来自当前切割步骤（与 PNG 同一套，见 sheetMarks.ts）
  const marks = computeSheetMarks(sheet, paper, input.task)

  // 页眉 / 落款：分别贴上、下纸边，水平居中；没填则不画
  for (const hf of [marks.header, marks.footer]) {
    if (!hf) continue
    if (hasNonAscii(hf.text)) {
      const strip = await renderTextStrip(hf.text, hf.sizeMm, 300)
      addImage(strip.image, hf.xMm - strip.wMm / 2, hf.yMm - strip.hMm / 2, strip.wMm, strip.hMm)
    } else {
      const sizePt = hf.sizeMm * S * 0.9
      body.push(text(px(hf.xMm), py(hf.yMm) - sizePt * 0.35, hf.text, sizePt, false, 'c'))
    }
  }

  // 照片
  for (const p of sheet.placements) {
    const ref = input.photoOf(p)
    const raster = ref ? photoRasters.get(ref.key) : undefined
    if (raster) {
      addImage(raster, p.x, p.y, p.w, p.h)
    } else {
      body.push('q 0.92 0.94 0.97 rg')
      body.push(`${n2(px(p.x))} ${n2(py(p.y + p.h))} ${n2(px(p.w))} ${n2(px(p.h))} re f Q`)
    }
    body.push('q 0.4 w 0.45 0.5 0.58 RG')
    body.push(`${n2(px(p.x))} ${n2(py(p.y + p.h))} ${n2(px(p.w))} ${n2(px(p.h))} re S Q`)
    const cx = px(p.x + p.w / 2)
    const cy = py(p.y + p.h / 2)
    body.push(text(cx, cy, `#${p.seq}`, Math.min(9, Math.max(5, p.h * 0.9)), true, 'c'))
    body.push(
      text(cx, cy - Math.min(9, Math.max(5, p.h * 0.9)) * 1.15, asciiOnly(input.sizeLabelOf(p)), 4.6, false, 'c'),
    )
  }

  // 纸张外框
  body.push('q 0.6 w 0.6 0.65 0.7 RG')
  body.push(`${n2(px(0.3))} ${n2(py(H - 0.3))} ${n2(px(W - 0.6))} ${n2(px(H - 0.6))} re S Q`)

  // 切割线：红色虚线，每刀标序号（白底红框）与走向箭头（from → to）
  const CUT = '0.78 0.16 0.12'
  if (marks.cuts.length) {
    body.push(`q 0.5 w ${CUT} RG [2.2 1.4] 0 d`)
    for (const c of marks.cuts) {
      body.push(`% cut ${c.n}`)
      if (c.axis === 'v') {
        body.push(`${n2(px(c.at))} ${n2(py(c.from))} m ${n2(px(c.at))} ${n2(py(c.to))} l S`)
      } else {
        body.push(`${n2(px(c.from))} ${n2(py(c.at))} m ${n2(px(c.to))} ${n2(py(c.at))} l S`)
      }
    }
    body.push('Q')
    // 走向箭头（指向 to 端）
    body.push(`q ${CUT} rg`)
    const aw = 1.1
    const al = 1.8
    for (const c of marks.cuts) {
      if (c.axis === 'v') {
        body.push(
          `${n2(px(c.at))} ${n2(py(c.to))} m ${n2(px(c.at - aw))} ${n2(py(c.to - al))} l ${n2(px(c.at + aw))} ${n2(py(c.to - al))} l f`,
        )
      } else {
        body.push(
          `${n2(px(c.to))} ${n2(py(c.at))} m ${n2(px(c.to - al))} ${n2(py(c.at - aw))} l ${n2(px(c.to - al))} ${n2(py(c.at + aw))} l f`,
        )
      }
    }
    body.push('Q')
    // 刀序标签（白底红框，位置由 sheetMarks 防重叠布局给出，与 PNG 一致）
    const lp = 8.5
    for (const c of marks.cuts) {
      const label = String(c.n)
      const cx = px(c.lx)
      const cy = py(c.ly)
      const bw = textW(label, lp) + 3.6
      const bh = lp + 3.2
      body.push(`q 1 1 1 rg ${CUT} RG 0.5 w ${n2(cx - bw / 2)} ${n2(cy - bh / 2)} ${n2(bw)} ${n2(bh)} re B Q`)
      body.push(`q ${CUT} rg`)
      body.push(text(cx, cy - lp * 0.35, label, lp, true, 'c'))
      body.push('Q')
    }
  }

  // 纸边裁切刻度：每刀坐标投影到垂直两条纸边（纸内 3mm 短刻度 + 刀序小字）
  const tickLen = 3
  if (marks.ticks.length) {
    body.push(`q 0.55 w ${CUT} RG`)
    for (const t of marks.ticks) {
      body.push(`% tick ${t.edge} ${n2(t.at)}`)
      if (t.edge === 'top') {
        body.push(`${n2(px(t.at))} ${n2(py(0))} m ${n2(px(t.at))} ${n2(py(tickLen))} l S`)
      } else if (t.edge === 'bottom') {
        body.push(`${n2(px(t.at))} ${n2(py(H - tickLen))} m ${n2(px(t.at))} ${n2(py(H))} l S`)
      } else if (t.edge === 'left') {
        body.push(`${n2(px(0))} ${n2(py(t.at))} m ${n2(px(tickLen))} ${n2(py(t.at))} l S`)
      } else {
        body.push(`${n2(px(W - tickLen))} ${n2(py(t.at))} m ${n2(px(W))} ${n2(py(t.at))} l S`)
      }
    }
    body.push('Q')
    body.push(`q ${CUT} rg`)
    for (const t of marks.ticks) {
      const label = tickLabel(t)
      if (t.edge === 'top') body.push(text(px(t.at), py(tickLen + 1.9), label, 5, false, 'c'))
      else if (t.edge === 'bottom') body.push(text(px(t.at), py(H - tickLen - 1.9), label, 5, false, 'c'))
      else if (t.edge === 'left') body.push(text(px(tickLen + 0.7), py(t.at) - 1.75, label, 5, false, 'l'))
      else body.push(text(px(W - tickLen - 0.7), py(t.at) - 1.75, label, 5, false, 'r'))
    }
    body.push('Q')
  }

  // 页脚信息（右对齐贴在纸边内，避免伸出纸外被裁掉）
  body.push(
    text(
      px(W - 2),
      py(1.6),
      `Sheet ${index + 1}/${input.sheets.length}  ${n2(W)}x${n2(H)}mm  Print at 100%`,
      4.2,
      false,
      'r',
    ),
  )

  return { wMm: W, hMm: H, content: [...head, ...body].join('\n'), images }
}

async function buildInfoPage(input: PdfBuildInput): Promise<PageSpec> {
  const W = 210
  const H = 297
  const px = (mm: number) => mm * S
  const py = (mm: number) => (H - mm) * S
  const body: string[] = []
  const images: PageImage[] = []

  body.push(text(px(15), py(18), 'Calibration ruler & cut list', 15, true))
  body.push(
    text(
      px(15),
      py(24),
      'Print at 100% (Actual size). Do NOT use "Fit to page".',
      9,
      false,
    ),
  )

  // 100mm 校验尺（矢量实线，与 PNG 纸下方那把尺同长）
  const y = 34
  body.push('q 0.8 w 0.1 0.1 0.1 RG')
  body.push(`${n2(px(15))} ${n2(py(y))} m ${n2(px(15 + RULER_LENGTH_MM))} ${n2(py(y))} l S`)
  for (let v = 0; v <= RULER_LENGTH_MM; v += 10) {
    body.push(`${n2(px(15 + v))} ${n2(py(y))} m ${n2(px(15 + v))} ${n2(py(y - 3))} l S`)
    body.push(text(px(15 + v), py(y - 7), `${v}`, 7, false, 'c'))
  }
  body.push('Q')
  body.push(text(px(15), py(y + 8), '100 mm ruler - measure this line after printing', 8))

  const lines: string[] = []
  lines.push(`任务：${input.task.name}｜相纸：${input.paper.name} ${input.paper.wMm}×${input.paper.hMm}mm`)
  lines.push(
    `隙距 ${input.task.gapMm}mm｜刀宽补偿 ${input.task.kerfMm}mm｜安全边 ${input.task.safeEdgeMm}mm｜共 ${input.sheets.length} 张相纸`,
  )
  lines.push('')
  for (const s of input.sheets) {
    lines.push(`【第 ${s.index + 1} 张】共 ${s.cutSteps.length} 刀（未合并 ${s.rawCutCount} 刀）`)
    s.cutSteps.forEach((c, i) => {
      if (c.axis === 'v') {
        lines.push(
          `  ${i + 1}. 竖切 x=${c.at.toFixed(1)}mm，y 从 ${c.from.toFixed(1)} 贯通到 ${c.to.toFixed(1)}mm`,
        )
      } else {
        lines.push(
          `  ${i + 1}. 横切 y=${c.at.toFixed(1)}mm，x 从 ${c.from.toFixed(1)} 贯通到 ${c.to.toFixed(1)}mm`,
        )
      }
    })
    lines.push('')
  }
  const block = await renderTextBlock(lines, 3.2, 300, 180)
  images.push({
    name: 'Im1',
    raster: block.image,
    xPt: px(15),
    yPt: py(46 + block.hMm),
    wPt: px(block.wMm),
    hPt: px(block.hMm),
  })
  body.push(
    `q ${n2(px(block.wMm))} 0 0 ${n2(px(block.hMm))} ${n2(px(15))} ${n2(py(46 + block.hMm))} cm /Im1 Do Q`,
  )

  return { wMm: W, hMm: H, content: body.join('\n'), images }
}

function assemble(pages: PageSpec[]): Blob {
  const objects: Uint8Array[] = []
  const pageObjNums: number[] = []
  const contentObjNums: number[] = []
  const base = 5
  pages.forEach((_, i) => {
    pageObjNums.push(base + i * 2)
    contentObjNums.push(base + i * 2 + 1)
  })
  let nextObj = base + pages.length * 2
  const imageObjNums: number[][] = pages.map((p) => p.images.map(() => nextObj++))
  const total = nextObj - 1

  // 1 Catalog / 2 Pages / 3 F1 / 4 F2
  objects.push(ascii('<< /Type /Catalog /Pages 2 0 R >>'))
  objects.push(
    ascii(
      `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjNums
        .map((n) => `${n} 0 R`)
        .join(' ')}] >>`,
    ),
  )
  objects.push(ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  objects.push(
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  )

  pages.forEach((page, i) => {
    const res = [`/Font << /F1 3 0 R /F2 4 0 R >>`]
    if (page.images.length) {
      res.push(
        `/XObject << ${page.images.map((im, k) => `/${im.name} ${imageObjNums[i][k]} 0 R`).join(' ')} >>`,
      )
    }
    objects.push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(page.wMm * S)} ${n2(
          page.hMm * S,
        )}] /Resources << ${res.join(' ')} >> /Contents ${contentObjNums[i]} 0 R >>`,
      ),
    )
    const stream = ascii(page.content)
    objects.push(
      concat([
        ascii(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        ascii('\nendstream'),
      ]),
    )
  })

  pages.forEach((page) => {
    for (const im of page.images) {
      objects.push(
        concat([
          ascii(
            `<< /Type /XObject /Subtype /Image /Width ${im.raster.wPx} /Height ${
              im.raster.hPx
            } /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${
              im.raster.data.length
            } >>\nstream\n`,
          ),
          im.raster.data,
          ascii('\nendstream'),
        ]),
      )
    }
  })

  if (objects.length !== total) {
    // 防御性校验：对象数量必须与预估一致
    throw new Error(`PDF 对象数量不一致：${objects.length} != ${total}`)
  }
  return serialize(objects)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function serialize(objects: Uint8Array[]): Blob {
  const header = ascii('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
  const chunks: Uint8Array[] = [header]
  let offset = header.length
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    const head = ascii(`${i + 1} 0 obj\n`)
    const tail = ascii('\nendobj\n')
    offsets.push(offset)
    chunks.push(head, obj, tail)
    offset += head.length + obj.length + tail.length
  })
  const xrefStart = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  chunks.push(ascii(xref), ascii(trailer))
  return new Blob(chunks, { type: 'application/pdf' })
}

/** 生成 1:1 打印 PDF：每张相纸一页（原始尺寸）+ 末页校验尺与切割清单 */
export async function buildPdf(input: PdfBuildInput): Promise<Blob> {
  const progress = input.onProgress ?? (() => {})
  const distinct = new Map<string, string>()
  for (const s of input.sheets) {
    for (const p of s.placements) {
      const ref = input.photoOf(p)
      if (ref && !distinct.has(ref.key)) distinct.set(ref.key, ref.url)
    }
  }
  const limit = input.maxPhotos ?? 60
  const embedPhotos = distinct.size > 0 && distinct.size <= limit
  const rasters = new Map<string, RasterImage>()
  if (embedPhotos) {
    let i = 0
    for (const [key, url] of distinct) {
      i += 1
      progress(`正在嵌入本机照片 ${i}/${distinct.size}`)
      try {
        rasters.set(key, await imageToJpeg(url, 1400, 0.88))
      } catch {
        /* 单张解码失败时跳过，仍会画出编号占位 */
      }
    }
  } else if (distinct.size > limit) {
    progress(`照片数量 ${distinct.size} 超过 ${limit} 张，本次仅导出编号排版（避免 PDF 过大）`)
  }

  const pages: PageSpec[] = []
  for (let i = 0; i < input.sheets.length; i++) {
    progress(`正在生成第 ${i + 1}/${input.sheets.length} 页`)
    pages.push(await buildSheetPage(input, input.sheets[i], i, rasters))
  }
  pages.push(await buildInfoPage(input))
  return assemble(pages)
}
