/**
 * 手写 PDF 生成器（不依赖任何第三方库）
 * - 页面尺寸 = 相纸实际尺寸（mm -> pt），按 100% 打印即为 1:1
 * - 照片以 JPEG XObject 嵌入；中文说明以位图嵌入（PDF 内置西文字体无法显示中文）
 */
import { imageToJpeg, renderTextBlock, renderTextStrip, type RasterImage } from './image'
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

/** 粗略估算 Helvetica 文本宽度（用于居中） */
const textW = (s: string, size: number) => s.length * size * 0.52

function text(x: number, y: number, s: string, size: number, bold = false, center = false) {
  const t = center ? x - textW(s, size) / 2 : x
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

  // 页眉 / 落款
  const header = input.task.headerText.trim()
  const footer = input.task.footerText.trim()
  for (const [txt, top] of [
    [header, true],
    [footer, false],
  ] as Array<[string, boolean]>) {
    if (!txt) continue
    const sizeMm = Math.max(1.5, Math.min(4, paper.marginMm * 0.5))
    const yMm = top ? paper.marginMm / 2 - sizeMm / 2 : H - paper.marginMm / 2 - sizeMm / 2
    if (hasNonAscii(txt)) {
      const strip = await renderTextStrip(txt, sizeMm, 300)
      addImage(strip.image, (W - strip.wMm) / 2, yMm, strip.wMm, strip.hMm)
    } else {
      body.push(text(px(W / 2), py(yMm + sizeMm) + sizeMm * 0.2 * S, txt, sizeMm * S * 0.9, false, true))
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
    body.push(text(cx, cy, `#${p.seq}`, Math.min(9, Math.max(5, p.h * 0.9)), true, true))
    body.push(
      text(cx, cy - Math.min(9, Math.max(5, p.h * 0.9)) * 1.15, asciiOnly(input.sizeLabelOf(p)), 4.6, false, true),
    )
  }

  // 切割线
  body.push('q 0.35 w 0.6 0.63 0.68 RG')
  for (const c of sheet.cutSteps) {
    if (c.axis === 'v') {
      body.push(`${n2(px(c.at))} ${n2(py(c.from))} m ${n2(px(c.at))} ${n2(py(c.to))} l S`)
    } else {
      body.push(`${n2(px(c.from))} ${n2(py(c.at))} m ${n2(px(c.to))} ${n2(py(c.at))} l S`)
    }
  }
  body.push('Q')

  // 纸张外框 + 页脚信息
  body.push('q 0.6 w 0.6 0.65 0.7 RG')
  body.push(`${n2(px(0.3))} ${n2(py(H - 0.3))} ${n2(px(W - 0.6))} ${n2(px(H - 0.6))} re S Q`)
  body.push(
    text(
      px(W - 2),
      py(1.6),
      `Sheet ${index + 1}/${input.sheets.length}  ${n2(W)}x${n2(H)}mm  Print at 100%`,
      4.2,
      false,
      false,
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

  // 100mm 校验尺（矢量）
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
