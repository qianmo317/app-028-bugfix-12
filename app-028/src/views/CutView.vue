<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SheetView from '../components/SheetView.vue'
import RulerScale from '../components/RulerScale.vue'
import { allPapers, getTask, makeThumbResolver, photoVersion, sheetsOf } from '../store'
import { resolvePaper } from '../logic/library'
import type { CutStep, Task } from '../logic/types'

const route = useRoute()
const router = useRouter()

const task = computed<Task | undefined>(() => getTask(String(route.params.id)))
const paper = computed(() => (task.value ? resolvePaper(task.value, allPapers.value) : allPapers.value[0]))
const sheets = computed(() => (task.value ? sheetsOf(task.value) : []))
const activeSheet = ref(0)
const step = ref(0)
const playing = ref(false)
let timer: number | undefined

const sheet = computed(() => sheets.value[Math.min(activeSheet.value, sheets.value.length - 1)])
const steps = computed(() => sheet.value?.cutSteps ?? [])
const totalSteps = computed(() => steps.value.length)

const thumbs = computed(() => {
  void photoVersion.value
  return task.value ? makeThumbResolver(task.value, sheets.value) : () => undefined
})

const scale = computed(() => {
  const p = paper.value
  return Math.max(0.6, Math.min(3, Math.min(900 / p.wMm, 640 / p.hMm)))
})

function describe(s: CutStep | undefined, i: number) {
  if (!s) return ''
  if (s.axis === 'v') {
    return `第 ${i + 1} 刀：竖切 x = ${s.at.toFixed(1)}mm，从 y=${s.from.toFixed(1)} 贯通到 y=${s.to.toFixed(1)}（长 ${(s.to - s.from).toFixed(1)}mm）`
  }
  return `第 ${i + 1} 刀：横切 y = ${s.at.toFixed(1)}mm，从 x=${s.from.toFixed(1)} 贯通到 x=${s.to.toFixed(1)}（长 ${(s.to - s.from).toFixed(1)}mm）`
}

function togglePlay() {
  playing.value = !playing.value
  if (playing.value) {
    if (step.value >= totalSteps.value) step.value = 0
    timer = window.setInterval(() => {
      if (step.value >= totalSteps.value) {
        playing.value = false
        window.clearInterval(timer)
        timer = undefined
        return
      }
      step.value += 1
    }, 800)
  } else if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function gotoStep(i: number) {
  playing.value = false
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
  step.value = i
}

watch(activeSheet, () => {
  playing.value = false
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
  step.value = 0
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

const allStepsText = computed(() => {
  const lines: string[] = []
  for (const s of sheets.value) {
    lines.push(`【第 ${s.index + 1} 张相纸】${paper.value.wMm}×${paper.value.hMm}mm，共 ${s.cutSteps.length} 刀`)
    s.cutSteps.forEach((c, i) => {
      lines.push(`  ${describe({ ...c, sheetIndex: s.index }, i)}`)
    })
  }
  return lines.join('\n')
})

function printList() {
  window.print()
}

function goto(routeName: string) {
  const t = task.value
  if (t) router.push(`/${routeName}/${t.id}`)
}
</script>

<template>
  <div v-if="!task" class="card">
    <h2>任务不存在</h2>
    <p>请回到<a href="/">新建任务</a>页重新创建。</p>
  </div>
  <div v-else class="stack">
    <div class="row no-print">
      <h1 style="margin: 0">裁切步骤</h1>
      <span class="badge brand">{{ task.name }}</span>
      <span class="badge">{{ sheets.length }} 张相纸</span>
      <span class="badge">
        本张 {{ totalSteps }} 刀（未合并 {{ sheet?.rawCutCount ?? 0 }} 刀）
      </span>
      <div class="spacer"></div>
      <button class="btn" @click="goto('layout')">← 排样预览</button>
      <button class="btn" @click="printList">打印步骤清单</button>
      <button class="btn primary" @click="goto('export')">导出 1:1 →</button>
    </div>

    <div v-if="task.manual && !task.manual.valid" class="note danger no-print">
      手工微调后的排样不满足 guillotine 贯通裁切，导出已停用：{{ task.manual.message }}
    </div>

    <div class="grid sidebar no-print">
      <div class="stack">
        <div class="card">
          <h3>
            纸面视图
            <span class="badge">{{ step >= totalSteps ? '已切完' : `当前第 ${step + 1} 刀` }}</span>
          </h3>
          <div class="card-sub">灰线 = 待切，红线 = 当前这一刀，绿线 = 已完成</div>
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
          <div v-if="sheet" class="sheet-wrap">
            <SheetView
              :sheet="sheet"
              :paper="paper"
              :safe-edge-mm="task.safeEdgeMm"
              :scale="scale"
              :highlight="step < totalSteps ? step : -1"
              :done-count="step"
              :show-cut-labels="true"
              :thumb-of="thumbs"
            />
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>播放控制</h3>
          <div class="row">
            <button class="btn small" @click="gotoStep(0)">⏮ 重置</button>
            <button class="btn small" :disabled="step <= 0" @click="gotoStep(step - 1)">上一步</button>
            <button class="btn primary small" @click="togglePlay">
              {{ playing ? '⏸ 暂停' : '▶ 播放' }}
            </button>
            <button class="btn small" :disabled="step >= totalSteps" @click="gotoStep(step + 1)">
              下一步
            </button>
            <button class="btn small" @click="gotoStep(totalSteps)">全部切完</button>
          </div>
          <div class="note" style="margin-top: 8px">
            {{ step >= totalSteps ? '全部切割线已完成，按编号取照片即可。' : describe(steps[step], step) }}
          </div>
        </div>

        <div class="card">
          <h3>步骤清单（第 {{ activeSheet + 1 }} 张）</h3>
          <div class="card-sub">点击任意一步可跳转高亮；相邻共边照片的切割线已合并成一条</div>
          <div class="steps">
            <div
              v-for="(c, i) in steps"
              :key="i"
              class="step"
              :class="{ active: i === step, done: i < step }"
              @click="gotoStep(i)"
            >
              <span class="idx">{{ i + 1 }}</span>
              <span>{{ describe(c, i) }}</span>
              <span v-if="c.merged" class="badge ok">共边合并</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>刀口说明</h3>
          <div class="kv">
            <dt>相邻照片间距</dt>
            <dd>{{ task.gapMm }} mm</dd>
            <dt>刀宽补偿</dt>
            <dd>{{ task.kerfMm }} mm（从照片外侧向内缩）</dd>
            <dt>四周安全边</dt>
            <dd>{{ task.safeEdgeMm }} mm</dd>
            <dt>纸边留白</dt>
            <dd>{{ paper.marginMm }} mm</dd>
          </div>
        </div>
      </div>
    </div>

    <!-- 打印版：贴在裁切台上 -->
    <div class="print-only">
      <h2>{{ task.name }} · 切割步骤清单</h2>
      <p class="mono">
        相纸 {{ paper.name }} {{ paper.wMm }}×{{ paper.hMm }}mm ｜ 隙距 {{ task.gapMm }}mm ｜
        刀宽补偿 {{ task.kerfMm }}mm ｜ 安全边 {{ task.safeEdgeMm }}mm
      </p>
      <RulerScale unit="mm" :length-mm="100" />
      <p style="margin-top: 8px">请按 100% 实际大小打印（关闭「适应页面 / Fit to page」）。</p>
      <pre class="mono" style="white-space: pre-wrap; font-size: 12px">{{ allStepsText }}</pre>
    </div>
  </div>
</template>
