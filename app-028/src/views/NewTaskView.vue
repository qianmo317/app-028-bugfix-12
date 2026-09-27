<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  addCustomSize,
  allPapers,
  allSizes,
  clearItemPhoto,
  createTask,
  deleteTask,
  getItemPhoto,
  leftovers,
  markLeftoverUsed,
  photoKey,
  photoVersion,
  runPack,
  setItemPhoto,
  settings,
  tasks,
  templates,
} from '../store'
import { findPhotoSize, newId } from '../logic/library'
import { formatCents, formatPercent } from '../logic/units'
import type { Item, Paper, PhotoRef, Task } from '../logic/types'

const router = useRouter()

const draft = reactive({
  name: '',
  paperId: 'p5x7',
  customPaper: {
    id: 'custom',
    name: '自定义相纸',
    wMm: 152,
    hMm: 210,
    marginMm: 3,
    priceCents: 200,
    kind: 'sheet',
  } as Paper,
  items: [] as Item[],
  gapMm: settings.value.gapMm,
  kerfMm: settings.value.kerfMm,
  safeEdgeMm: settings.value.safeEdgeMm,
  allowRotate: settings.value.allowRotate,
  headerText: '',
  footerText: '',
})

const error = ref('')
const hint = ref('')
const newSize = reactive({ name: '', wMm: 50, hMm: 70 })

/** 读取内存照片（依赖 photoVersion 触发重绘） */
function thumb(key: string): string | undefined {
  void photoVersion.value
  return getItemPhoto(key)?.url
}

const currentPaper = computed<Paper>(() =>
  draft.paperId === 'custom'
    ? draft.customPaper
    : allPapers.value.find((p) => p.id === draft.paperId) ?? allPapers.value[0],
)

const usableText = computed(() => {
  const p = currentPaper.value
  const w = p.wMm - 2 * (p.marginMm + draft.safeEdgeMm)
  const h = p.hMm - 2 * (p.marginMm + draft.safeEdgeMm)
  if (w <= 0 || h <= 0) return '安全边已超过相纸尺寸'
  return `${w.toFixed(1)} × ${h.toFixed(1)} mm`
})

const totalQty = computed(() => draft.items.reduce((a, i) => a + Math.max(0, i.qty), 0))

function addItem(sizeId?: string) {
  const size = sizeId ?? allSizes.value[0]?.id
  if (!size) return
  const s = findPhotoSize(allSizes.value, size)
  draft.items.push({
    id: newId('item'),
    sizeId: size,
    qty: 1,
    rotateAllowed: s?.rotateByDefault ?? false,
    repeatSamePhoto: true,
    keepTogether: false,
  })
}

function removeItem(id: string) {
  draft.items = draft.items.filter((i) => i.id !== id)
}

function onSizeChange(item: Item) {
  const s = findPhotoSize(allSizes.value, item.sizeId)
  item.rotateAllowed = s?.rotateByDefault ?? false
}

function applyTemplate(tplId: string) {
  const tpl = templates.value.find((t) => t.id === tplId)
  if (!tpl) return
  draft.paperId = tpl.paperId
  draft.name = tpl.name
  draft.items = tpl.items.map((i) => ({
    id: newId('item'),
    sizeId: i.sizeId,
    qty: i.qty,
    rotateAllowed: i.rotateAllowed,
    repeatSamePhoto: true,
    keepTogether: i.keepTogether,
  }))
  hint.value = `已套用模板「${tpl.name}」`
}

async function pickFile(item: Item, copyIndex: number, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = ''
  try {
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = url
    })
    const refInfo: PhotoRef = {
      name: file.name,
      wPx: img.naturalWidth,
      hPx: img.naturalHeight,
      landscape: img.naturalWidth > img.naturalHeight,
    }
    setItemPhoto(photoKey(item.id, copyIndex), url, refInfo)
    if (copyIndex === 0) item.photo = refInfo
    const s = findPhotoSize(allSizes.value, item.sizeId)
    if (s && refInfo.landscape && s.hMm > s.wMm && !item.rotateAllowed) {
      hint.value = `「${s.name}」底片是横向的，可勾选「允许旋转」让排样器自动转 90° 试试`
    } else {
      hint.value = `已在本机读取「${file.name}」：${img.naturalWidth}×${img.naturalHeight}px（不会上传）`
    }
  } catch {
    error.value = '照片文件读取失败，请换一张图片（仅在本机内存中读取尺寸与方向）'
  }
  input.value = ''
}

function removeFile(item: Item, copyIndex: number) {
  clearItemPhoto(photoKey(item.id, copyIndex))
  if (copyIndex === 0) item.photo = undefined
}

function useLeftover(id: string) {
  const l = leftovers.value.find((x) => x.id === id)
  if (!l) return
  draft.paperId = 'custom'
  draft.customPaper = {
    id: 'custom',
    name: `余料 ${l.name}`,
    wMm: l.wMm,
    hMm: l.hMm,
    marginMm: l.marginMm,
    priceCents: l.priceCents,
    kind: 'sheet',
  }
  markLeftoverUsed(id)
  hint.value = `已使用余料「${l.name}」${l.wMm}×${l.hMm}mm`
}

function addSize() {
  if (!newSize.name.trim()) {
    error.value = '请填写自定义尺寸名称'
    return
  }
  if (newSize.wMm <= 0 || newSize.hMm <= 0) {
    error.value = '自定义尺寸必须大于 0'
    return
  }
  const s = addCustomSize({
    name: newSize.name.trim(),
    wMm: newSize.wMm,
    hMm: newSize.hMm,
    rotateByDefault: false,
  })
  newSize.name = ''
  addItem(s.id)
}

function submit() {
  error.value = ''
  hint.value = ''
  if (!draft.items.length) {
    error.value = '请先添加照片清单'
    return
  }
  if (draft.items.some((i) => i.qty <= 0)) {
    error.value = '照片数量必须大于 0'
    return
  }
  const task: Task = createTask({
    name: draft.name || undefined,
    paperId: draft.paperId,
    customPaper: draft.paperId === 'custom' ? { ...draft.customPaper } : undefined,
    items: draft.items.map((i) => ({ ...i })),
    gapMm: draft.gapMm,
    kerfMm: draft.kerfMm,
    safeEdgeMm: draft.safeEdgeMm,
    allowRotate: draft.allowRotate,
    headerText: draft.headerText,
    footerText: draft.footerText,
  })
  const err = runPack(task)
  if (err) {
    error.value = err
    return
  }
  router.push(`/layout/${task.id}`)
}

function openTask(t: Task, route: string) {
  router.push(`/${route}/${t.id}`)
}

function taskPaperName(t: Task) {
  if (t.paperId === 'custom' && t.customPaper) return t.customPaper.name
  return allPapers.value.find((p) => p.id === t.paperId)?.name ?? '未知相纸'
}
</script>

<template>
  <div class="stack">
    <div class="row">
      <h1 style="margin: 0">新建拼版任务</h1>
      <span class="badge brand">相纸 + 照片清单</span>
      <div class="spacer"></div>
      <span class="badge">共 {{ totalQty }} 张照片</span>
    </div>

    <div v-if="error" class="note danger">{{ error }}</div>
    <div v-if="hint" class="note ok">{{ hint }}</div>

    <div class="grid sidebar">
      <div class="stack">
        <div class="card">
          <h3>① 相纸规格</h3>
          <div class="card-sub">可用区已扣掉纸边留白与四周安全边</div>
          <div class="stack">
            <label class="field">
              相纸
              <select v-model="draft.paperId">
                <option v-for="p in allPapers" :key="p.id" :value="p.id">
                  {{ p.name }} · {{ p.wMm }}×{{ p.hMm }}mm · {{ formatCents(p.priceCents) }}/张
                </option>
                <option value="custom">自定义相纸…</option>
              </select>
            </label>
            <div v-if="draft.paperId === 'custom'" class="grid cols-2">
              <label class="field">
                宽 mm
                <input v-model.number="draft.customPaper.wMm" type="number" min="10" step="0.1" />
              </label>
              <label class="field">
                高 mm
                <input v-model.number="draft.customPaper.hMm" type="number" min="10" step="0.1" />
              </label>
              <label class="field">
                纸边留白 mm
                <input v-model.number="draft.customPaper.marginMm" type="number" min="0" step="0.5" />
              </label>
              <label class="field">
                单价（分）
                <input v-model.number="draft.customPaper.priceCents" type="number" min="0" step="10" />
              </label>
            </div>
            <div class="kv">
              <dt>相纸尺寸</dt>
              <dd>{{ currentPaper.wMm }} × {{ currentPaper.hMm }} mm</dd>
              <dt>可用区</dt>
              <dd>{{ usableText }}</dd>
              <dt>单张成本</dt>
              <dd>{{ formatCents(currentPaper.priceCents) }}</dd>
            </div>
            <div class="grid cols-2">
              <label class="field">
                页眉（打印在纸边）
                <input v-model="draft.headerText" type="text" placeholder="如 Studio 2026" />
              </label>
              <label class="field">
                落款（打印在纸边）
                <input v-model="draft.footerText" type="text" placeholder="如 2026-09-20" />
              </label>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>③ 裁切参数</h3>
          <div class="card-sub">间隙 0 = 共边裁切；刀宽补偿从照片外侧向内缩</div>
          <div class="stack">
            <label class="field">
              相邻照片间距 gapMm：{{ draft.gapMm }} mm
              <input v-model.number="draft.gapMm" type="range" min="0" max="10" step="0.5" />
            </label>
            <label class="field">
              最小裁切余量（刀宽补偿）kerfMm：{{ draft.kerfMm }} mm
              <input v-model.number="draft.kerfMm" type="range" min="0" max="3" step="0.1" />
            </label>
            <label class="field">
              四周安全边 safeEdgeMm：{{ draft.safeEdgeMm }} mm
              <input v-model.number="draft.safeEdgeMm" type="range" min="0" max="20" step="0.5" />
            </label>
            <label class="check">
              <input v-model="draft.allowRotate" type="checkbox" />
              允许整体旋转 90°（证件照建议关闭）
            </label>
          </div>
        </div>

        <div class="card">
          <h3>余料库</h3>
          <div class="card-sub">排样剩下的纸边可以登记，下次优先用余料</div>
          <div v-if="!leftovers.length" class="note">暂无登记余料，可在「排样预览」页把剩余纸边登记进来</div>
          <table v-else class="data">
            <thead>
              <tr>
                <th>余料</th>
                <th class="num">尺寸 mm</th>
                <th class="num">用过</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in leftovers" :key="l.id">
                <td>{{ l.name }}</td>
                <td class="num">{{ l.wMm }}×{{ l.hMm }}</td>
                <td class="num">{{ l.usedCount }}</td>
                <td><button class="btn small" @click="useLeftover(l.id)">用作相纸</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>
            ② 照片清单
            <span class="row tight">
              <button class="btn small" @click="addItem()">+ 添加一行</button>
              <button class="btn small" :disabled="!draft.items.length" @click="draft.items = []">
                清空
              </button>
            </span>
          </h3>
          <div class="card-sub">
            尺寸库为毫米；底片只在浏览器内存里读尺寸与方向，不上传服务器
          </div>
          <div v-if="!draft.items.length" class="note">还没有照片，点「+ 添加一行」或直接套用下方证件照模板</div>
          <table v-else class="data">
            <thead>
              <tr>
                <th>照片尺寸</th>
                <th class="num" style="width: 76px">数量</th>
                <th>旋转</th>
                <th>不拆散</th>
                <th>底片</th>
                <th>本机照片文件</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in draft.items" :key="item.id">
                <td>
                  <select v-model="item.sizeId" @change="onSizeChange(item)">
                    <option v-for="s in allSizes" :key="s.id" :value="s.id">
                      {{ s.name }} {{ s.wMm }}×{{ s.hMm }}mm
                    </option>
                  </select>
                </td>
                <td>
                  <input v-model.number="item.qty" type="number" min="1" step="1" />
                </td>
                <td>
                  <input v-model="item.rotateAllowed" type="checkbox" title="允许旋转 90°" />
                </td>
                <td>
                  <input v-model="item.keepTogether" type="checkbox" title="该尺寸尽量排在同一张相纸上" />
                </td>
                <td>
                  <select v-model="item.repeatSamePhoto">
                    <option :value="true">重复排</option>
                    <option :value="false">只出现一次</option>
                  </select>
                </td>
                <td>
                  <div class="row tight">
                    <img
                      v-if="thumb(photoKey(item.id, 0))"
                      :src="thumb(photoKey(item.id, 0))"
                      alt=""
                      style="width: 34px; height: 34px; object-fit: cover; border: 1px solid var(--line); border-radius: 4px"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      style="width: 150px"
                      @change="pickFile(item, 0, $event)"
                    />
                    <button
                      v-if="thumb(photoKey(item.id, 0))"
                      class="btn small"
                      @click="removeFile(item, 0)"
                    >
                      移除
                    </button>
                  </div>
                  <div v-if="item.photo" class="mono" style="font-size: 11px; color: var(--ink-3)">
                    {{ item.photo.wPx }}×{{ item.photo.hPx }}px
                    {{ item.photo.landscape ? '横向' : '纵向' }}
                  </div>
                </td>
                <td>
                  <button class="btn small danger" @click="removeItem(item.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="row" style="margin-top: 12px">
            <label class="field" style="max-width: 150px">
              自定义尺寸名称
              <input v-model="newSize.name" type="text" placeholder="如 3 寸" />
            </label>
            <label class="field" style="max-width: 100px">
              宽 mm
              <input v-model.number="newSize.wMm" type="number" min="1" step="0.1" />
            </label>
            <label class="field" style="max-width: 100px">
              高 mm
              <input v-model.number="newSize.hMm" type="number" min="1" step="0.1" />
            </label>
            <button class="btn" @click="addSize">加入尺寸库并添加</button>
          </div>
        </div>

        <div class="card">
          <h3>证件照 / 冲印模板</h3>
          <div class="card-sub">一键生成常用排版清单</div>
          <div class="row">
            <button v-for="t in templates" :key="t.id" class="btn small" @click="applyTemplate(t.id)">
              {{ t.name }}
            </button>
          </div>
        </div>

        <div class="card">
          <h3>
            开始排样
            <span class="badge">guillotine 约束</span>
          </h3>
          <div class="row">
            <label class="field" style="max-width: 260px">
              任务名称
              <input v-model="draft.name" type="text" placeholder="可留空自动命名" />
            </label>
            <button class="btn primary" @click="submit">排样并预览 →</button>
          </div>
        </div>

        <div class="card">
          <h3>已保存任务（{{ tasks.length }}）</h3>
          <div v-if="!tasks.length" class="note">暂无任务</div>
          <table v-else class="data">
            <thead>
              <tr>
                <th>任务</th>
                <th>相纸</th>
                <th class="num">照片</th>
                <th class="num">张数</th>
                <th class="num">利用率</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tasks" :key="t.id">
                <td>{{ t.name }}</td>
                <td>{{ taskPaperName(t) }}</td>
                <td class="num">{{ t.result?.stats.totalPhotos ?? 0 }}</td>
                <td class="num">{{ t.result?.stats.sheets ?? 0 }}</td>
                <td class="num">
                  {{ t.result ? formatPercent(t.result.stats.avgUtilization) : '—' }}
                </td>
                <td>
                  <div class="row tight">
                    <button class="btn small" @click="openTask(t, 'layout')">排样</button>
                    <button class="btn small" @click="openTask(t, 'cut')">裁切</button>
                    <button class="btn small" @click="openTask(t, 'export')">导出</button>
                    <button class="btn small danger" @click="deleteTask(t.id)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
