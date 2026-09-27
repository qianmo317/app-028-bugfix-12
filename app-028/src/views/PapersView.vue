<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  addCustomPaper,
  addCustomSize,
  allPapers,
  allSizes,
  leftovers,
  removeCustomPaper,
  removeCustomSize,
  removeLeftover,
  templates,
} from '../store'
import { BUILTIN_PAPERS, BUILTIN_PHOTO_SIZES } from '../logic/library'
import { formatCents, inchToMm } from '../logic/units'

const error = ref('')
const msg = ref('')

const paperForm = reactive({
  name: '',
  wMm: 152,
  hMm: 203,
  marginMm: 3,
  priceCents: 200,
  kind: 'sheet' as 'sheet' | 'roll',
})

const sizeForm = reactive({ name: '', wMm: 50, hMm: 70, rotateByDefault: false })

const builtinPaperIds = new Set(BUILTIN_PAPERS.map((p) => p.id))
const builtinSizeIds = new Set(BUILTIN_PHOTO_SIZES.map((s) => s.id))

function addPaper() {
  error.value = ''
  if (!paperForm.name.trim()) {
    error.value = '请填写相纸名称'
    return
  }
  if (paperForm.wMm <= 0 || paperForm.hMm <= 0) {
    error.value = '相纸尺寸必须大于 0'
    return
  }
  addCustomPaper({ ...paperForm, name: paperForm.name.trim() })
  msg.value = `已新增相纸「${paperForm.name}」`
  paperForm.name = ''
}

function addSize() {
  error.value = ''
  if (!sizeForm.name.trim()) {
    error.value = '请填写照片尺寸名称'
    return
  }
  if (sizeForm.wMm <= 0 || sizeForm.hMm <= 0) {
    error.value = '照片尺寸必须大于 0'
    return
  }
  addCustomSize({ ...sizeForm, name: sizeForm.name.trim() })
  msg.value = `已新增照片尺寸「${sizeForm.name}」`
  sizeForm.name = ''
}

function inchHint(wMm: number, hMm: number): string {
  return `${(wMm / inchToMm(1)).toFixed(2)}″ × ${(hMm / inchToMm(1)).toFixed(2)}″`
}
</script>

<template>
  <div class="stack">
    <div class="row">
      <h1 style="margin: 0">相纸与照片尺寸库</h1>
      <span class="badge brand">本地打包，无外网请求</span>
    </div>
    <div v-if="error" class="note danger">{{ error }}</div>
    <div v-if="msg" class="note ok">{{ msg }}</div>

    <div class="grid cols-2">
      <div class="card">
        <h3>相纸规格（{{ allPapers.length }}）</h3>
        <div class="card-sub">单价用于成本核算；「卷筒」按整卷计价</div>
        <table class="data">
          <thead>
            <tr>
              <th>名称</th>
              <th class="num">宽×高 mm</th>
              <th class="num">英寸</th>
              <th class="num">纸边留白</th>
              <th class="num">单价</th>
              <th>来源</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in allPapers" :key="p.id">
              <td>
                {{ p.name }}
                <span v-if="p.kind === 'roll'" class="badge">卷筒</span>
              </td>
              <td class="num">{{ p.wMm }} × {{ p.hMm }}</td>
              <td class="num">{{ inchHint(p.wMm, p.hMm) }}</td>
              <td class="num">{{ p.marginMm }}mm</td>
              <td class="num">{{ formatCents(p.priceCents) }}</td>
              <td>
                <span class="badge" :class="builtinPaperIds.has(p.id) ? '' : 'brand'">
                  {{ builtinPaperIds.has(p.id) ? '内置' : '自定义' }}
                </span>
              </td>
              <td>
                <button
                  v-if="!builtinPaperIds.has(p.id)"
                  class="btn small danger"
                  @click="removeCustomPaper(p.id)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <h4 style="margin-top: 14px">新增自定义相纸</h4>
        <div class="row">
          <label class="field" style="max-width: 180px">
            名称
            <input v-model="paperForm.name" type="text" placeholder="如 20×24 英寸" />
          </label>
          <label class="field" style="max-width: 96px">
            宽 mm
            <input v-model.number="paperForm.wMm" type="number" min="10" step="0.1" />
          </label>
          <label class="field" style="max-width: 96px">
            高 mm
            <input v-model.number="paperForm.hMm" type="number" min="10" step="0.1" />
          </label>
          <label class="field" style="max-width: 110px">
            纸边留白 mm
            <input v-model.number="paperForm.marginMm" type="number" min="0" step="0.5" />
          </label>
          <label class="field" style="max-width: 110px">
            单价（分）
            <input v-model.number="paperForm.priceCents" type="number" min="0" step="10" />
          </label>
          <label class="field" style="max-width: 110px">
            类型
            <select v-model="paperForm.kind">
              <option value="sheet">单张</option>
              <option value="roll">卷筒</option>
            </select>
          </label>
          <button class="btn" @click="addPaper">新增</button>
        </div>
      </div>

      <div class="card">
        <h3>照片尺寸（{{ allSizes.length }}）</h3>
        <div class="card-sub">单位统一 mm；「默认旋转」决定新任务里是否勾选允许 90° 旋转</div>
        <table class="data">
          <thead>
            <tr>
              <th>名称</th>
              <th class="num">宽×高 mm</th>
              <th class="num">英寸</th>
              <th>默认旋转</th>
              <th>来源</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in allSizes" :key="s.id">
              <td>{{ s.name }}</td>
              <td class="num">{{ s.wMm }} × {{ s.hMm }}</td>
              <td class="num">{{ inchHint(s.wMm, s.hMm) }}</td>
              <td>{{ s.rotateByDefault ? '允许' : '不允许' }}</td>
              <td>
                <span class="badge" :class="builtinSizeIds.has(s.id) ? '' : 'brand'">
                  {{ builtinSizeIds.has(s.id) ? '内置' : '自定义' }}
                </span>
              </td>
              <td>
                <button
                  v-if="!builtinSizeIds.has(s.id)"
                  class="btn small danger"
                  @click="removeCustomSize(s.id)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <h4 style="margin-top: 14px">新增自定义照片尺寸</h4>
        <div class="row">
          <label class="field" style="max-width: 160px">
            名称
            <input v-model="sizeForm.name" type="text" placeholder="如 8 寸" />
          </label>
          <label class="field" style="max-width: 96px">
            宽 mm
            <input v-model.number="sizeForm.wMm" type="number" min="1" step="0.1" />
          </label>
          <label class="field" style="max-width: 96px">
            高 mm
            <input v-model.number="sizeForm.hMm" type="number" min="1" step="0.1" />
          </label>
          <label class="check" style="margin-top: 16px">
            <input v-model="sizeForm.rotateByDefault" type="checkbox" />
            默认允许旋转
          </label>
          <button class="btn" @click="addSize">新增</button>
        </div>

        <h4 style="margin-top: 14px">内置排版模板</h4>
        <table class="data">
          <thead>
            <tr>
              <th>模板</th>
              <th>相纸</th>
              <th>清单</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in templates" :key="t.id">
              <td>{{ t.name }}</td>
              <td>{{ allPapers.find((p) => p.id === t.paperId)?.name ?? t.paperId }}</td>
              <td class="mono" style="font-size: 12px">
                {{
                  t.items
                    .map(
                      (i) =>
                        `${allSizes.find((s) => s.id === i.sizeId)?.name ?? i.sizeId}×${i.qty}`,
                    )
                    .join(' + ')
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>余料库（{{ leftovers.length }}）</h3>
      <div class="card-sub">在「排样预览」页把剩余纸边登记进来，下次排样可直接用作相纸</div>
      <div v-if="!leftovers.length" class="note">暂无登记余料</div>
      <table v-else class="data">
        <thead>
          <tr>
            <th>名称</th>
            <th class="num">尺寸 mm</th>
            <th class="num">已使用次数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in leftovers" :key="l.id">
            <td>{{ l.name }}</td>
            <td class="num">{{ l.wMm }} × {{ l.hMm }}</td>
            <td class="num">{{ l.usedCount }}</td>
            <td><button class="btn small danger" @click="removeLeftover(l.id)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
