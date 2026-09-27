<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SheetView from '../components/SheetView.vue'
import UtilizationBar from '../components/UtilizationBar.vue'
import {
  addLeftover,
  allPapers,
  allSizes,
  getTask,
  makeThumbResolver,
  manualPlacementsOf,
  resetManual,
  setManual,
  sheetsOf,
  photoVersion,
} from '../store'
import { comparePapers, computeCost } from '../logic/cost'
import { findPhotoSize, groupsFromTask, resolvePaper, sizeLabel } from '../logic/library'
import { formatCents, formatPercent } from '../logic/units'
import type { PaperCompare } from '../logic/cost'
import type { Placement, Task } from '../logic/types'

const route = useRoute()
const router = useRouter()

const task = computed<Task | undefined>(() => getTask(String(route.params.id)))
const activeSheet = ref(0)
const selectedSeq = ref(-1)
const dragState = ref<{ seq: number; x: number; y: number } | null>(null)
const localMsg = ref('')

const paper = computed(() => (task.value ? resolvePaper(task.value, allPapers.value) : allPapers.value[0]))
const sheets = computed(() => (task.value ? sheetsOf(task.value) : []))
const sheet = computed(() => sheets.value[Math.min(activeSheet.value, Math.max(0, sheets.value.length - 1))])
const cost = computed(() => (task.value?.result ? computeCost(paper.value, task.value.result) : undefined))
const totalPhotos = computed(() =>
  sheets.value.reduce((acc, s) => acc + s.placements.length, 0),
)
const totalSteps = computed(() => sheets.value.reduce((acc, s) => acc + s.cutSteps.length, 0))
const rawSteps = computed(() => sheets.value.reduce((acc, s) => acc + s.rawCutCount, 0))

const thumbs = computed(() => {
  void photoVersion.value
  return task.value ? makeThumbResolver(task.value, sheets.value) : () => undefined
})

/** 拖动中用本地覆盖，避免每帧全量校验 */
const displaySheets = computed(() => {
  const list = sheets.value
  const d = dragState.value
  if (!d) return list
  return list.map((s) => ({
    ...s,
    placements: s.placements.map((p) => (p.seq === d.seq ? { ...p, x: d.x, y: d.y } : p)),
  }))
})
const displaySheet = computed(() =>
  displaySheets.value[Math.min(activeSheet.value, Math.max(0, displaySheets.value.length - 1))],
)

const scale = computed(() => {
  const p = paper.value
  const maxW = 900
  const maxH = 640
  return Math.max(0.6, Math.min(3, Math.min(maxW / p.wMm, maxH / p.hMm)))
})

const comparisons = ref<PaperCompare[]>([])
const compareError = ref('')

function runCompare() {
  const t = task.value
  if (!t) return
  compareError.value = ''
  const groups = groupsFromTask(t, allSizes.value)
  if (!groups.length) {
    compareError.value = '清单为空'
    return
  }
  comparisons.value = comparePapers(
    groups,
    {
      safeEdgeMm: t.safeEdgeMm,
      gapMm: t.gapMm,
      kerfMm: t.kerfMm,
      allowRotate: t.allowRotate,
    },
    allPapers.value.filter((x) => x.id !== 'proll152'),
    t.paperId,
  )
}

function onMove(payload: { seq: number; x: number; y: number }) {
  dragState.value = payload
}

function onMoveEnd(payload: { seq: number; x: number; y: number }) {
  dragState.value = null
  const t = task.value
  if (!t) return
  const list = manualPlacementsOf(t)
  const target = list.find((p) => p.seq === payload.seq)
  if (!target) return
  const snapped = snapPosition(t, list, payload.seq, payload.x, payload.y)
  applyEdit(
    list.map((p) => (p.seq === payload.seq ? { ...p, x: snapped.x, y: snapped.y } : p)),
  )
}

function snapPosition(t: Task, list: Placement[], seq: number, x: number, y: number) {
  const p = list.find((q) => q.seq === seq)
  if (!p) return { x, y }
  const pp = resolvePaper(t, allPapers.value)
  const inset = pp.marginMm + t.safeEdgeMm
  const minX = inset
  const maxX = Math.max(inset, pp.wMm - inset - p.w)
  const minY = inset
  const maxY = Math.max(inset, pp.hMm - inset - p.h)
  const spacing = t.kerfMm + t.gapMm
  const xs = [minX, maxX]
  const ys = [minY, maxY]
  for (const q of list) {
    if (q.seq === seq || q.sheetIndex !== p.sheetIndex) continue
    xs.push(q.x - p.w - spacing, q.x + q.w + spacing)
    ys.push(q.y - p.h - spacing, q.y + q.h + spacing)
  }
  const pick = (v: number, cands: number[], min: number, max: number) => {
    let best = v
    let bestD = 1.8
    for (const c of cands) {
      const d = Math.abs(c - v)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return Math.round(Math.min(max, Math.max(min, best)) * 1000) / 1000
  }
  return { x: pick(x, xs, minX, maxX), y: pick(y, ys, minY, maxY) }
}

function applyEdit(list: Placement[]) {
  const t = task.value
  if (!t) return
  setManual(t, list)
  localMsg.value = ''
}

function clampPlacement(t: Task, p: Placement): Placement {
  const pp = resolvePaper(t, allPapers.value)
  const inset = pp.marginMm + t.safeEdgeMm
  return {
    ...p,
    x: Math.round(Math.min(Math.max(inset, p.x), Math.max(inset, pp.wMm - inset - p.w)) * 1000) / 1000,
    y: Math.round(Math.min(Math.max(inset, p.y), Math.max(inset, pp.hMm - inset - p.h)) * 1000) / 1000,
  }
}

function rotateSelected() {
  const t = task.value
  if (!t) return
  if (selectedSeq.value < 0) {
    localMsg.value = '请先在纸面上点选一张照片'
    return
  }
  const list = manualPlacementsOf(t)
  const p = list.find((x) => x.seq === selectedSeq.value)
  if (!p) return
  const item = t.items.find((i) => i.id === p.itemId)
  if (!t.allowRotate || !item?.rotateAllowed) {
    localMsg.value = '该尺寸禁止旋转 90°（证件照方向有要求）'
    return
  }
  const next = clampPlacement(t, { ...p, w: p.h, h: p.w, rotated: !p.rotated })
  applyEdit(list.map((x) => (x.seq === p.seq ? next : x)))
}

function moveToSheet(sheetIndex: number) {
  const t = task.value
  if (!t || selectedSeq.value < 0) {
    localMsg.value = '请先在纸面上点选一张照片'
    return
  }
  const list = manualPlacementsOf(t)
  const p = list.find((x) => x.seq === selectedSeq.value)
  if (!p) return
  const moved = clampPlacement(t, { ...p, sheetIndex })
  applyEdit(list.map((x) => (x.seq === p.seq ? moved : x)))
}

function nudge(dx: number, dy: number) {
  const t = task.value
  if (!t || selectedSeq.value < 0) {
    localMsg.value = '请先在纸面上点选一张照片'
    return
  }
  const list = manualPlacementsOf(t)
  const p = list.find((x) => x.seq === selectedSeq.value)
  if (!p) return
  const next = clampPlacement(t, { ...p, x: p.x + dx, y: p.y + dy })
  applyEdit(list.map((x) => (x.seq === p.seq ? next : x)))
}

function doReset() {
  const t = task.value
  if (!t) return
  resetManual(t)
  localMsg.value = '已恢复自动排样结果'
  selectedSeq.value = -1
}

function registerWaste(w: number, h: number) {
  const t = task.value
  if (!t) return
  addLeftover({
    name: `${t.name} 余料`,
    wMm: Math.round(w * 10) / 10,
    hMm: Math.round(h * 10) / 10,
    marginMm: 0,
    priceCents: 0,
  })
  localMsg.value = `已登记余料 ${w.toFixed(1)}×${h.toFixed(1)}mm`
}

function registerAllWaste() {
  const s = sheet.value
  if (!s) return
  for (const r of s.wasteRects) registerWaste(r.w, r.h)
}

function selectedInfo() {
  const t = task.value
  if (!t || selectedSeq.value < 0) return undefined
  const p = manualPlacementsOf(t).find((x) => x.seq === selectedSeq.value)
  if (!p) return undefined
  const item = t.items.find((i) => i.id === p.itemId)
  return { p, item, size: item ? findPhotoSize(allSizes.value, item.sizeId) : undefined }
}

const info = computed(selectedInfo)

const manual = computed(() => task.value?.manual)
const lowUtil = computed(() => (sheet.value ? sheet.value.utilization < 0.7 : false))

function goto(routeName: string) {
  const t = task.value
  if (t) router.push(`/${routeName}/${t.id}`)
}

// 利用率低于 70% 时自动试算其它相纸规格做对比
watch(
  () => task.value?.result,
  () => {
    const t = task.value
    if (!t?.result) return
    if (t.result.stats.avgUtilization >= 0.7) {
      comparisons.value = []
      return
    }
    runCompare()
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="!task" class="card">
    <h2>任务不存在</h2>
    <p>可能已被删除，请回到<a href="/">新建任务</a>页重新创建。</p>
  </div>
  <div v-else class="stack">
    <div class="row">
      <h1 style="margin: 0">{{ task.name }}</h1>
      <span class="badge brand">{{ paper.name }} {{ paper.wMm }}×{{ paper.hMm }}mm</span>
      <span class="badge">{{ totalPhotos }} 张照片</span>
      <span class="badge">{{ sheets.length }} 张相纸</span>
      <span class="badge">{{ totalSteps }} 刀（未合并 {{ rawSteps }} 刀）</span>
      <div class="spacer"></div>
      <button class="btn" @click="goto('cut')">裁切步骤 →</button>
      <button class="btn primary" @click="goto('export')">导出 1:1 →</button>
    </div>

    <div v-if="localMsg" class="note">{{ localMsg }}</div>
    <div
      v-if="manual"
      class="note"
      :class="manual.valid ? 'ok' : 'danger'"
    >
      手工微调：{{ manual.message }}
      <template v-if="manual.valid">
        （增量校验 {{ manual.validationMs }}ms，共 {{ manual.stepCount }} 刀）
      </template>
      <button class="btn small" style="margin-left: 8px" @click="doReset">恢复自动排样</button>
    </div>

    <div class="grid sidebar">
      <div class="stack">
        <div class="card">
          <h3>纸面视图</h3>
          <div class="card-sub">
            毫米网格（细线 10mm / 粗线 50mm）；虚线框为「纸边留白 + 安全边」后的可用区
          </div>
          <div class="row" style="margin-bottom: 8px">
            <button
              v-for="(s, i) in sheets"
              :key="s.index"
              class="btn small"
              :class="{ primary: i === activeSheet }"
              @click="activeSheet = i"
            >
              第 {{ i + 1 }} 张
            </button>
          </div>
          <div v-if="displaySheet" class="sheet-wrap">
            <SheetView
              :sheet="displaySheet"
              :paper="paper"
              :safe-edge-mm="task.safeEdgeMm"
              :scale="scale"
              draggable
              :show-cut-labels="true"
              :thumb-of="thumbs"
              @move="onMove"
              @moveend="onMoveEnd"
              @select="(seq) => (selectedSeq = seq)"
            />
          </div>
          <div class="legend" style="margin-top: 8px">
            <span><i style="background: #9aa6b4"></i>切割线</span>
            <span><i style="background: #6d7c8f"></i>照片边界</span>
            <span><i style="background: #c3ccd9"></i>安全边</span>
            <span>↻ = 已旋转 90°</span>
          </div>
        </div>

        <div class="card">
          <h3>第 {{ activeSheet + 1 }} 张：照片清单（对号入座）</h3>
          <table class="data">
            <thead>
              <tr>
                <th class="num">编号</th>
                <th>尺寸</th>
                <th class="num">位置 x/y mm</th>
                <th class="num">宽×高 mm</th>
                <th>旋转</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in displaySheet?.placements ?? []" :key="p.seq">
                <td class="num">#{{ p.seq }}</td>
                <td>
                  {{
                    sizeLabel(
                      findPhotoSize(
                        allSizes,
                        task.items.find((i) => i.id === p.itemId)?.sizeId ?? '',
                      ),
                    )
                  }}
                </td>
                <td class="num">{{ p.x.toFixed(1) }} / {{ p.y.toFixed(1) }}</td>
                <td class="num">{{ p.w.toFixed(1) }}×{{ p.h.toFixed(1) }}</td>
                <td>{{ p.rotated ? '90°' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>利用率与张数</h3>
          <UtilizationBar
            :value="sheet ? sheet.utilization : 0"
            label="本张利用率"
            :detail="sheet ? `照片面积 ${sheet.usedAreaMm2.toFixed(0)}mm² / 纸张面积 ${sheet.sheetAreaMm2.toFixed(0)}mm²` : ''"
          />
          <div style="height: 10px"></div>
          <UtilizationBar
            :value="task.result ? task.result.stats.avgUtilization : 0"
            label="整单平均利用率"
            :detail="`${sheets.length} 张相纸，共 ${totalPhotos} 张照片`"
          />
          <div class="kv" style="margin-top: 12px">
            <dt>排样耗时</dt>
            <dd>{{ task.result ? task.result.stats.elapsedMs + ' ms' : '—' }}</dd>
            <dt>切割步数（已合并）</dt>
            <dd>{{ totalSteps }}</dd>
            <dt>切割步数（未合并）</dt>
            <dd>{{ rawSteps }}</dd>
          </div>
        </div>

        <div v-if="lowUtil" class="card">
          <h3>换纸试算</h3>
          <div class="note warn">
            当前利用率低于 70%，建议换更大/更小的纸张试试（点下方按钮试算 2~3 种规格）
          </div>
          <div class="row" style="margin-top: 8px">
            <button class="btn small" @click="runCompare">试算其它相纸</button>
            <span v-if="compareError" class="badge danger">{{ compareError }}</span>
          </div>
          <table v-if="comparisons.length" class="data" style="margin-top: 8px">
            <thead>
              <tr>
                <th>相纸</th>
                <th class="num">张数</th>
                <th class="num">利用率</th>
                <th class="num">总价</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in comparisons" :key="c.paper.id">
                <td>{{ c.paper.name }}</td>
                <td class="num">{{ c.sheets }}</td>
                <td class="num">{{ formatPercent(c.avgUtilization) }}</td>
                <td class="num">{{ formatCents(c.totalCents) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h3>成本核算</h3>
          <div v-if="cost" class="kv">
            <dt>相纸单价</dt>
            <dd>{{ formatCents(paper.priceCents) }}/张</dd>
            <dt>用纸张数</dt>
            <dd>{{ cost.sheets }}</dd>
            <dt>总材料成本</dt>
            <dd>{{ formatCents(cost.totalCents) }}</dd>
            <dt>每张照片摊薄</dt>
            <dd>{{ formatCents(cost.perPhotoCents) }}</dd>
            <dt>本方案浪费率</dt>
            <dd>{{ formatPercent(cost.wasteRate) }}</dd>
            <dt>逐张打印浪费率</dt>
            <dd>{{ formatPercent(cost.naiveWasteRate) }}</dd>
            <dt>节省</dt>
            <dd>{{ formatCents(cost.savedCents) }}</dd>
          </div>
        </div>

        <div class="card">
          <h3>手工微调</h3>
          <div class="card-sub">
            拖动照片自动吸附到相邻照片与安全边；松开后立刻重新校验 guillotine 合法性（增量校验，不重新排样）
          </div>
          <div v-if="!info" class="note">点选纸面上的一张照片后即可微调</div>
          <div v-else class="stack">
            <div class="kv">
              <dt>选中</dt>
              <dd>#{{ info.p.seq }} {{ info.size?.name }}</dd>
              <dt>位置</dt>
              <dd>{{ info.p.x.toFixed(1) }} / {{ info.p.y.toFixed(1) }} mm</dd>
              <dt>尺寸</dt>
              <dd>{{ info.p.w.toFixed(1) }}×{{ info.p.h.toFixed(1) }} mm</dd>
            </div>
            <div class="row">
              <button class="btn small" @click="rotateSelected">旋转 90°</button>
              <button class="btn small" @click="nudge(-1, 0)">← 1mm</button>
              <button class="btn small" @click="nudge(1, 0)">→ 1mm</button>
              <button class="btn small" @click="nudge(0, -1)">↑ 1mm</button>
              <button class="btn small" @click="nudge(0, 1)">↓ 1mm</button>
              <button class="btn small" @click="nudge(-0.5, -0.5)">-0.5</button>
              <button class="btn small" @click="nudge(0.5, 0.5)">+0.5</button>
            </div>
            <label class="field">
              移到第几张相纸
              <select
                :value="info.p.sheetIndex"
                @change="moveToSheet(Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="(_, i) in sheets" :key="i" :value="i">第 {{ i + 1 }} 张</option>
              </select>
            </label>
          </div>
        </div>

        <div class="card">
          <h3>
            余料登记
            <button class="btn small" :disabled="!sheet?.wasteRects.length" @click="registerAllWaste">
              全部登记
            </button>
          </h3>
          <div class="card-sub">把剩下的纸边记录下来，下次排样优先使用</div>
          <div v-if="!sheet?.wasteRects.length" class="note">本张相纸没有可登记的余料</div>
          <table v-else class="data">
            <thead>
              <tr>
                <th class="num">位置 mm</th>
                <th class="num">尺寸 mm</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in sheet.wasteRects" :key="i">
                <td class="num">{{ r.x.toFixed(1) }} / {{ r.y.toFixed(1) }}</td>
                <td class="num">{{ r.w.toFixed(1) }} × {{ r.h.toFixed(1) }}</td>
                <td>
                  <button class="btn small" @click="registerWaste(r.w, r.h)">登记</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
