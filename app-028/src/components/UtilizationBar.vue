<script setup lang="ts">
import { computed } from 'vue'
import { formatPercent } from '../logic/units'

const props = withDefaults(
  defineProps<{
    value: number
    label?: string
    detail?: string
  }>(),
  { label: '利用率', detail: '' },
)

const cls = computed(() => (props.value < 0.7 ? 'low' : props.value >= 0.85 ? 'high' : ''))
const pct = computed(() => Math.max(0, Math.min(1, props.value)) * 100)
</script>

<template>
  <div class="stack" style="gap: 4px">
    <div class="row" style="justify-content: space-between">
      <span style="font-size: 12.5px; color: var(--ink-2)">{{ label }}</span>
      <span class="mono" style="font-weight: 700">{{ formatPercent(value) }}</span>
    </div>
    <div class="progress" :class="cls"><i :style="{ width: `${pct}%` }"></i></div>
    <span v-if="detail" style="font-size: 11.5px; color: var(--ink-3)">{{ detail }}</span>
  </div>
</template>
