/** 本机图片读取与 canvas 渲染工具（全部在浏览器本地完成，无任何网络请求） */

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = url
  })
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface RasterImage {
  data: Uint8Array
  wPx: number
  hPx: number
}

/** 把本机图片转成 JPEG 字节（用于嵌入 PDF / 导出位图） */
export async function imageToJpeg(url: string, maxPx = 1400, quality = 0.9): Promise<RasterImage> {
  const img = await loadImage(url)
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const comma = dataUrl.indexOf(',')
  return { data: base64ToBytes(dataUrl.slice(comma + 1)), wPx: w, hPx: h }
}

/** 把一段文字渲染成 JPEG（PDF 内置西文字体无法显示中文，中文用位图嵌入） */
export async function renderTextStrip(
  text: string,
  fontSizeMm: number,
  dpi = 300,
): Promise<{ image: RasterImage; wMm: number; hMm: number }> {
  const pxPerMm = dpi / 25.4
  const fontPx = Math.max(6, Math.round(fontSizeMm * pxPerMm))
  const measure = document.createElement('canvas')
  const mctx = measure.getContext('2d')
  const font = `${fontPx}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  let textW = 10
  if (mctx) {
    mctx.font = font
    textW = Math.ceil(mctx.measureText(text).width)
  }
  const pad = Math.round(fontPx * 0.2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, textW + pad * 2)
  canvas.height = Math.max(2, Math.round(fontPx * 1.5))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.fillText(text, pad, canvas.height / 2)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const comma = dataUrl.indexOf(',')
  return {
    image: { data: base64ToBytes(dataUrl.slice(comma + 1)), wPx: canvas.width, hPx: canvas.height },
    wMm: canvas.width / pxPerMm,
    hMm: canvas.height / pxPerMm,
  }
}

const FONT_STACK = 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'

/** 多行文字块渲染成 JPEG（中文说明与清单用位图嵌入 PDF） */
export async function renderTextBlock(
  lines: string[],
  fontSizeMm: number,
  dpi = 300,
  maxWidthMm = 180,
): Promise<{ image: RasterImage; wMm: number; hMm: number }> {
  const pxPerMm = dpi / 25.4
  const fontPx = Math.max(6, Math.round(fontSizeMm * pxPerMm))
  const font = `${fontPx}px ${FONT_STACK}`
  const measure = document.createElement('canvas').getContext('2d')
  let maxW = 40
  if (measure) {
    measure.font = font
    for (const l of lines) maxW = Math.max(maxW, measure.measureText(l).width)
  }
  const lineH = Math.round(fontPx * 1.6)
  const pad = Math.round(fontPx * 0.3)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(maxW) + pad * 2
  canvas.height = lineH * Math.max(1, lines.length) + pad * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.font = font
  ctx.textBaseline = 'top'
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lineH))
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const comma = dataUrl.indexOf(',')
  const wMm = canvas.width / pxPerMm
  const hMm = canvas.height / pxPerMm
  const fit = Math.min(1, maxWidthMm / wMm)
  return {
    image: { data: base64ToBytes(dataUrl.slice(comma + 1)), wPx: canvas.width, hPx: canvas.height },
    wMm: wMm * fit,
    hMm: hMm * fit,
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
