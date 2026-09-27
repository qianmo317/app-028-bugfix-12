<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

const props = withDefaults(
  defineProps<{
    unit?: 'px' | 'mm'
    scale?: number
    lengthMm?: number
    stepMm?: number
  }>(),
  { unit: 'px', scale: 2, lengthMm: 100, stepMm: 10 },
)

const u = (mm: number) => (props.unit === 'mm' ? `${mm}mm` : `${mm * props.scale}px`)
const tickThickness = computed(() => (props.unit === 'mm' ? '0.2mm' : '1px'))
const fontSm = computed(() => (props.unit === 'mm' ? '2.4mm' : '10px'))

const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= props.lengthMm + 1e-9; v += props.stepMm) out.push(Math.round(v * 100) / 100)
  return out
})

const barStyle = computed<CSSProperties>(() => ({
  position: 'relative',
  width: u(props.lengthMm),
  height: u(props.stepMm),
  borderBottom: `${tickThickness.value} solid #1f2733`,
}))
</script>

<template>
  <div class="stack" style="gap: 6px">
    <div :style="barStyle">
      <i
        v-for="t in ticks"
        :key="`t${t}`"
        :style="{
          position: 'absolute',
          left: u(t),
          bottom: '0',
          width: tickThickness,
          height: u(stepMm * 0.5),
          background: '#1f2733',
        }"
      ></i>
      <span
        v-for="t in ticks"
        :key="`l${t}`"
        class="mono"
        :style="{
          position: 'absolute',
          left: u(t),
          top: '0',
          transform: 'translateX(-50%)',
          fontSize: fontSm,
          color: '#5a6572',
        }"
      >
        {{ t }}
      </span>
    </div>
    <span :style="{ fontSize: fontSm }" class="mono">
      100mm 校验尺：打印后用直尺量这段横线，必须正好 100mm
    </span>
  </div>
</template>
