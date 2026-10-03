<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Paper, Placement, Sheet } from '../logic/types'

const props = withDefaults(
  defineProps<{
    sheet: Sheet
    paper: Paper
    safeEdgeMm?: number
    scale?: number
    unit?: 'px' | 'mm'
    showCuts?: boolean
    showNumbers?: boolean
    showGrid?: boolean
    showSafeArea?: boolean
    showCutLabels?: boolean
    showCropMarks?: boolean
    highlight?: number
    doneCount?: number
    draggable?: boolean
    invalid?: boolean
    headerText?: string
    footerText?: string
    thumbOf?: (p: Placement) => string | undefined
    labelOf?: (itemId: string) => string
  }>(),
  {
    safeEdgeMm: 3,
    scale: 2,
    unit: 'px',
    showCuts: true,
    showNumbers: true,
    showGrid: true,
    showSafeArea: true,
    showCutLabels: false,
    showCropMarks: false,
    highlight: -1,
    doneCount: -1,
    draggable: false,
    invalid: false,
    headerText: '',
    footerText: '',
    thumbOf: undefined,
    labelOf: undefined,
  },
)

const emit = defineEmits<{
  (e: 'move', payload: { seq: number; x: number; y: number }): void
  (e: 'moveend', payload: { seq: number; x: number; y: number }): void
  (e: 'select', seq: number): void
}>()

const u = (mm: number) => (props.unit === 'mm' ? `${mm}mm` : `${mm * props.scale}px`)
const hair = computed(() => (props.unit === 'mm' ? '0.15mm' : '1px'))
const cutW = computed(() => (props.unit === 'mm' ? '0.28mm' : '1.6px'))
const textSm = computed(() => (props.unit === 'mm' ? '2.5mm' : '10px'))
const textXs = computed(() => (props.unit === 'mm' ? '2.1mm' : '9px'))
/** 切割虚线的实段/空段（mm），屏幕按 scale 换算成 px */
const dashOn = computed(() => (props.unit === 'mm' ? '2.2mm' : `${2.2 * props.scale}px`))
const dashOff = computed(() => (props.unit === 'mm' ? '1.4mm' : `${1.4 * props.scale}px`))

const inset = computed(() => props.paper.marginMm + props.safeEdgeMm)
const usableW = computed(() => Math.max(0, props.paper.wMm - 2 * inset.value))
const usableH = computed(() => Math.max(0, props.paper.hMm - 2 * inset.value))

const paperStyle = computed(() => ({
  width: u(props.paper.wMm),
  height: u(props.paper.hMm),
}))

const gridStyle = computed(() => {
  const t = hair.value
  const minor = u(10)
  const major = u(50)
  return {
    backgroundImage: [
      `repeating-linear-gradient(to right, #eef1f6 0 ${t}, transparent ${t} ${minor})`,
      `repeating-linear-gradient(to bottom, #eef1f6 0 ${t}, transparent ${t} ${minor})`,
      `repeating-linear-gradient(to right, #dde4ee 0 ${t}, transparent ${t} ${major})`,
      `repeating-linear-gradient(to bottom, #dde4ee 0 ${t}, transparent ${t} ${major})`,
    ].join(','),
  }
})

const safeStyle = computed(() => ({
  left: u(inset.value),
  top: u(inset.value),
  width: u(usableW.value),
  height: u(usableH.value),
  borderWidth: props.unit === 'mm' ? '0.15mm' : '1px',
}))

function phStyle(p: Placement) {
  return {
    left: u(p.x),
    top: u(p.y),
    width: u(p.w),
    height: u(p.h),
    borderWidth: props.unit === 'mm' ? '0.2mm' : '1px',
  }
}

function cutStyle(c: Sheet['cutSteps'][number], index: number) {
  const active = props.highlight === index
  const done = props.doneCount >= 0 && index < props.doneCount
  const color = active ? '#e53935' : done ? '#1a7f4b' : '#5d6b7d'
  const base: Record<string, string> = {
    // 虚线刀路（on/off 沿刀线方向重复）；激活/完成时改实色便于逐步演示
    background: active || done
      ? color
      : `repeating-linear-gradient(${c.axis === 'v' ? 'to bottom' : 'to right'}, ${color} 0 ${dashOn.value}, transparent ${dashOn.value} calc(${dashOn.value} + ${dashOff.value}))`,
    zIndex: active ? '6' : '3',
  }
  if (c.axis === 'v') {
    base.left = u(c.at)
    base.top = u(c.from)
    base.width = cutW.value
    base.height = u(c.to - c.from)
  } else {
    base.top = u(c.at)
    base.left = u(c.from)
    base.height = cutW.value
    base.width = u(c.to - c.from)
  }
  return base
}

function cutLabelStyle(c: Sheet['cutSteps'][number]) {
  if (c.axis === 'v') {
    return {
      left: u(c.at),
      top: u((c.from + c.to) / 2),
      transform: 'translate(-50%, -50%)',
      fontSize: textXs.value,
    }
  }
  return {
    left: u((c.from + c.to) / 2),
    top: u(c.at),
    transform: 'translate(-50%, -50%)',
    fontSize: textXs.value,
  }
}

const dragSeq = ref(-1)
let startX = 0
let startY = 0
let originX = 0
let originY = 0

function onPointerDown(ev: PointerEvent, p: Placement) {
  if (!props.draggable || props.unit !== 'px') return
  ev.preventDefault()
  const el = ev.currentTarget as HTMLElement
  el.setPointerCapture(ev.pointerId)
  dragSeq.value = p.seq
  startX = ev.clientX
  startY = ev.clientY
  originX = p.x
  originY = p.y
  emit('select', p.seq)
}

function onPointerMove(ev: PointerEvent) {
  if (dragSeq.value < 0) return
  emit('move', {
    seq: dragSeq.value,
    x: originX + (ev.clientX - startX) / props.scale,
    y: originY + (ev.clientY - startY) / props.scale,
  })
}

function onPointerUp() {
  if (dragSeq.value < 0) return
  const p = props.sheet.placements.find((x) => x.seq === dragSeq.value)
  const seq = dragSeq.value
  dragSeq.value = -1
  if (p) emit('moveend', { seq, x: p.x, y: p.y })
}

const headerFontSize = computed(() => {
  const mm = Math.max(1.5, Math.min(4, props.paper.marginMm * 0.5))
  return props.unit === 'mm' ? `${mm}mm` : `${mm * props.scale}px`
})

/** 纸边短刻度：只标出真正切到对应纸边的刀（at/from/to 直接决定位置） */
const TICK_OUT = 3.2
const TICK_IN = 1.8

/** 水平方向贪心避让：相邻行号太近时向外错行 */
function staggerRows(xs: number[], minGapMm: number): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const rows = new Array<number>(xs.length).fill(0)
  for (let k = 1; k < order.length; k++) {
    const i = order[k]
    let row = 0
    for (let j = 0; j < k; j++) {
      const p = order[j]
      if (Math.abs(xs[i] - xs[p]) < minGapMm && rows[p] >= row) row = rows[p] + 1
    }
    rows[i] = row
  }
  return rows
}

const edgeMarks = computed(() => {
  const H = props.paper.hMm
  const W = props.paper.wMm
  const vTopList: Array<{ at: number; no: number; row: number }> = []
  const vBottomList: Array<{ at: number }> = []
  const hLeftList: Array<{ at: number }> = []
  const hRightList: Array<{ at: number; no: number; row: number }> = []
  props.sheet.cutSteps.forEach((c, i) => {
    if (c.axis === 'v') {
      if (Math.abs(c.from - 0) <= 0.002) vTopList.push({ at: c.at, no: i + 1, row: 0 })
      if (Math.abs(c.to - H) <= 0.002) vBottomList.push({ at: c.at })
    } else {
      if (Math.abs(c.from - 0) <= 0.002) hLeftList.push({ at: c.at })
      if (Math.abs(c.to - W) <= 0.002) hRightList.push({ at: c.at, no: i + 1, row: 0 })
    }
  })
  staggerRows(vTopList.map((m) => m.at), 5).forEach((row, i) => (vTopList[i].row = row))
  staggerRows(hRightList.map((m) => m.at), 4.5).forEach((row, i) => (hRightList[i].row = row))
  return { vTop: vTopList, vBottom: vBottomList, hLeft: hLeftList, hRight: hRightList }
})

/** 页眉贴上纸边、水平居中；margin 为 0 时仍贴在纸内 0.8mm 处，不压纸边 */
const headerStyle = computed(() => ({
  left: '50%',
  top: u(Math.max(0.8, props.paper.marginMm / 2)),
  transform: 'translate(-50%, -50%)',
  fontSize: headerFontSize.value,
}))

/** 落款贴下纸边、水平居中 */
const footerStyle = computed(() => ({
  left: '50%',
  top: u(props.paper.hMm - Math.max(0.8, props.paper.marginMm / 2)),
  transform: 'translate(-50%, -50%)',
  fontSize: headerFontSize.value,
}))

const showDetail = computed(() => props.scale >= 1.6 || props.unit === 'mm')
</script>

<template>
  <div class="sheet-canvas" :style="paperStyle">
    <div class="sheet-grid" :style="gridStyle"></div>
    <div v-if="showSafeArea" class="sheet-safe" :style="safeStyle"></div>

    <div v-if="headerText" class="sheet-header" :style="headerStyle">
      {{ headerText }}
    </div>
    <div v-if="footerText" class="sheet-footer" :style="footerStyle">
      {{ footerText }}
    </div>

    <div
      v-for="p in sheet.placements"
      :key="p.seq"
      class="ph"
      :class="{ draggable, invalid, dragging: dragSeq === p.seq }"
      :style="phStyle(p)"
      @pointerdown="onPointerDown($event, p)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img v-if="thumbOf && thumbOf(p)" :src="thumbOf(p)" alt="" draggable="false" />
      <template v-if="showNumbers">
        <span class="ph-no" :style="{ fontSize: textSm }">#{{ p.seq }}</span>
        <span v-if="showDetail" class="ph-dim" :style="{ fontSize: textXs }">
          {{ p.w.toFixed(0) }}×{{ p.h.toFixed(0) }}<template v-if="p.rotated">↻</template>
        </span>
      </template>
    </div>

    <template v-if="showCuts">
      <div
        v-for="(c, i) in sheet.cutSteps"
        :key="`c${i}`"
        class="cutline"
        :class="{ hl: highlight === i, done: doneCount >= 0 && i < doneCount }"
        :style="cutStyle(c, i)"
      ></div>
      <template v-if="showCutLabels">
        <div v-for="(c, i) in sheet.cutSteps" :key="`l${i}`" class="cut-label" :style="cutLabelStyle(c)">
          {{ i + 1 }}
        </div>
      </template>
    </template>

    <!-- 纸边裁切短刻度（打印导出稿用：外 3.2mm 内 1.8mm，跨在纸边上） -->
    <template v-if="showCropMarks">
      <div
        v-for="(m, i) in edgeMarks.vTop"
        :key="`vt${i}`"
        class="crop-mark"
        :style="{
          left: u(m.at),
          top: u(-TICK_OUT),
          height: u(TICK_OUT + TICK_IN),
          width: cutW,
        }"
      ></div>
      <div
        v-for="(m, i) in edgeMarks.vBottom"
        :key="`vb${i}`"
        class="crop-mark"
        :style="{
          left: u(m.at),
          top: u(props.paper.hMm - TICK_IN),
          height: u(TICK_OUT + TICK_IN),
          width: cutW,
        }"
      ></div>
      <div
        v-for="(m, i) in edgeMarks.hLeft"
        :key="`hl${i}`"
        class="crop-mark"
        :style="{
          top: u(m.at),
          left: u(-TICK_OUT),
          width: u(TICK_OUT + TICK_IN),
          height: cutW,
        }"
      ></div>
      <div
        v-for="(m, i) in edgeMarks.hRight"
        :key="`hr${i}`"
        class="crop-mark"
        :style="{
          top: u(m.at),
          left: u(props.paper.wMm - TICK_IN),
          width: u(TICK_OUT + TICK_IN),
          height: cutW,
        }"
      ></div>
    </template>
  </div>
</template>
