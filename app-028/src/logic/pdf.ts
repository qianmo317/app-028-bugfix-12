/**
 * 手写 PDF 生成器（不依赖任何第三方库）
 * - 每张相纸一页：页面 = 相纸尺寸 + 四周标注带（与 PNG 完全相同的画面，见 logic/art.ts）
 * - 照片以 JPEG XObject 嵌入；中文页眉/落款以位图嵌入（PDF 内置西文字体无法显示中文）
 * - 末页为 100mm 校验尺与切割清单（A4）
 */
import { imageToJpeg, renderTextBlock, renderTextStrip, type RasterImage } from './image'
import { computeFrame, paintSheetArt, type ArtPhoto, type Painter } from './art'
import { MM_TO_PT } from './units'
import type { Paper, Placement, Sheet, Task } from './types'

const S = MM_TO_PT

const n2 = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2))
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

/** #rrggbb -> "r g b"（0~1） */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`
}

/** 粗略 Helvetica 文本宽度（mm），需与 art.ts 的 asciiWidth 保持一致 */
const textWMm = (s: string, sizeMm: number) => s.length * sizeMm * 0.56

/**
 * PDF 画面后端：输入纸张坐标系 mm（(0,0)=纸左上角，y 向下，标注带为负坐标），
 * 内部换算成 PDF 用户坐标 pt（左下原点，y 向上）。
 */
class PdfPainter implements Painter {
  private body: string[] = []
  images: PageImage[] = []
  private imgIdx = 0

  constructor(
    private pageH: number,
    private offX: number,
    private offY: number,
    private photos: Map<string, RasterImage>,
  ) {}

  get content(): string {
    return this.body.join('\n')
  }

  /** 纸张坐标 mm -> PDF 坐标 pt */
  private X(mm: number): number {
    return (this.offX + mm) * S
  }
  private Y(mm: number): number {
    return (this.pageH - this.offY - mm) * S
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.body.push(`q ${rgb(color)} rg`)
    this.body.push(`${n2(this.X(x))} ${n2(this.Y(y + h))} ${n2(w * S)} ${n2(h * S)} re f Q`)
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, widthMm = 0.2): void {
    this.body.push(`q ${n2(widthMm * S)} w ${rgb(color)} RG`)
    this.body.push(`${n2(this.X(x))} ${n2(this.Y(y + h))} ${n2(w * S)} ${n2(h * S)} re S Q`)
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, widthMm = 0.2, dashMm?: [number, number]): void {
    const dash = dashMm ? `[${n2(dashMm[0] * S)} ${n2(dashMm[1] * S)}] 0 d ` : ''
    this.body.push(`q ${n2(widthMm * S)} w ${rgb(color)} RG ${dash}`)
    this.body.push(`${n2(this.X(x1))} ${n2(this.Y(y1))} m ${n2(this.X(x2))} ${n2(this.Y(y2))} l S Q`)
  }

  async text(
    x: number,
    y: number,
    s: string,
    sizeMm: number,
    color: string,
    align: 'left' | 'center' | 'right' = 'left',
    halo = false,
  ): Promise<void> {
    if (!s) return
    if (hasNonAscii(s)) {
      const strip = await renderTextStrip(s, sizeMm, 300)
      const x0 = align === 'center' ? x - strip.wMm / 2 : align === 'right' ? x - strip.wMm : x
      this.addImage(strip.image, x0, y - strip.hMm / 2, strip.wMm, strip.hMm)
      return
    }
    const w = textWMm(s, sizeMm)
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    if (halo) {
      // PDF 无法给文字描边：用白色底块保证压图可读
      const pad = 0.4
      this.fillRect(x0 - pad, y - sizeMm * 0.55, w + pad * 2, sizeMm * 1.1, '#ffffff')
    }
    this.body.push(`BT /F1 ${n2(sizeMm * S)} Tf ${rgb(color)} rg`)
    this.body.push(`${n2(this.X(x0))} ${n2(this.Y(y) + sizeMm * 0.35 * S)} Td (${pdfEscape(s)}) Tj ET`)
  }

  async pill(cx: number, cy: number, w: number, h: number, fill: string, stroke: string): Promise<void> {
    const r = h / 2
    const x = this.X(cx - w / 2)
    const y = this.Y(cy + h / 2)
    const ww = w * S
    const hh = h * S
    const rr = r * S
    const k = 0.5523 * rr
    this.body.push(`q ${rgb(fill)} rg ${rgb(stroke)} RG ${n2(0.18 * S)} w`)
    this.body.push(
      [
        `${n2(x + rr)} ${n2(y)} m`,
        `${n2(x + ww - rr)} ${n2(y)} l`,
        `${n2(x + ww - rr + k)} ${n2(y)} ${n2(x + ww)} ${n2(y + rr - k)} ${n2(x + ww)} ${n2(y + rr)} c`,
        `${n2(x + ww)} ${n2(y + hh - rr)} l`,
        `${n2(x + ww)} ${n2(y + hh - rr + k)} ${n2(x + ww - rr + k)} ${n2(y + hh)} ${n2(x + ww - rr)} ${n2(y + hh)} c`,
        `${n2(x + rr)} ${n2(y + hh)} l`,
        `${n2(x + rr - k)} ${n2(y + hh)} ${n2(x)} ${n2(y + hh - rr + k)} ${n2(x)} ${n2(y + hh - rr)} c`,
        `${n2(x)} ${n2(y + rr)} l`,
        `${n2(x)} ${n2(y + rr - k)} ${n2(x + rr - k)} ${n2(y)} ${n2(x + rr)} ${n2(y)} c`,
        'h B Q',
      ].join(' '),
    )
  }

  private addImage(raster: RasterImage, xMm: number, yMm: number, wMm: number, hMm: number): void {
    this.imgIdx += 1
    const name = `Im${this.imgIdx}`
    this.images.push({
      name,
      raster,
      xPt: this.X(xMm),
      yPt: this.Y(yMm + hMm),
      wPt: wMm * S,
      hPt: hMm * S,
    })
    this.body.push(
      `q ${n2(wMm * S)} 0 0 ${n2(hMm * S)} ${n2(this.X(xMm))} ${n2(this.Y(yMm + hMm))} cm /${name} Do Q`,
    )
  }

  async drawPhoto(photo: ArtPhoto, x: number, y: number, w: number, h: number): Promise<void> {
    const raster = this.photos.get(photo.key)
    if (!raster) {
      this.fillRect(x, y, w, h, '#eef2f7')
      return
    }
    this.addImage(raster, x, y, w, h)
  }
}

async function buildSheetPage(
  input: PdfBuildInput,
  sheet: Sheet,
  index: number,
  photoRasters: Map<string, RasterImage>,
): Promise<PageSpec> {
  const { paper } = input
  const frame = computeFrame(paper)
  const painter = new PdfPainter(
    frame.heightMm,
    frame.left,
    frame.top,
    photoRasters,
  )
  await paintSheetArt({
    task: input.task,
    paper,
    sheet,
    sheetIndex: index,
    sheetCount: input.sheets.length,
    frame,
    painter,
    photoOf: input.photoOf,
    sizeLabelOf: input.sizeLabelOf,
  })
  return { wMm: frame.widthMm, hMm: frame.heightMm, content: painter.content, images: painter.images }
}

async function buildInfoPage(input: PdfBuildInput): Promise<PageSpec> {
  const W = 210
  const H = 297
  const px = (mm: number) => mm * S
  const py = (mm: number) => (H - mm) * S
  const body: string[] = []
  const images: PageImage[] = []

  const text = (x: number, y: number, s: string, size: number, bold = false) =>
    `BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${n2(x)} ${n2(y)} Td (${pdfEscape(s)}) Tj ET`

  body.push(text(px(15), py(18), 'Calibration ruler & cut list', 15, true))
  body.push(text(px(15), py(24), 'Print at 100% (Actual size). Do NOT use "Fit to page".', 9))

  // 100mm 校验尺（矢量实线）
  const y = 34
  body.push('q 0.8 w 0.1 0.1 0.1 RG')
  body.push(`${n2(px(15))} ${n2(py(y))} m ${n2(px(115))} ${n2(py(y))} l S`)
  for (let v = 0; v <= 100; v += 10) {
    body.push(`${n2(px(15 + v))} ${n2(py(y))} m ${n2(px(15 + v))} ${n2(py(y - 3))} l S`)
    body.push(text(px(15 + v) - 4, py(y - 7), `${v}`, 7))
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
  // 高位二进制标记（与原版一致，提示阅读器本文件含 8-bit 数据）
  const header = ascii('%PDF-1.4\n%âãÏÓ\n')
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

/**
 * 生成 1:1 打印 PDF：每张相纸一页（相纸 + 标注带，与 PNG 同画面）+ 末页校验尺与切割清单。
 * PDF 为矢量打印母版；当 PDF 与图片不一致时以 PDF 为准。
 */
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
