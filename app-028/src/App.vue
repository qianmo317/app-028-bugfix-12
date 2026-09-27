<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="app-header no-print">
    <div class="app-header-inner">
      <div class="brand">
        <strong>相纸拼版与裁切排版</strong>
        <span>Photo Print Imposition Studio · 纯前端 · 数据不出本机</span>
      </div>
      <nav class="nav">
        <RouterLink to="/" exact-active-class="active" active-class="">新建任务</RouterLink>
        <RouterLink to="/papers" active-class="active">尺寸库</RouterLink>
        <RouterLink to="/settings" active-class="active">裁切参数</RouterLink>
      </nav>
      <div class="spacer"></div>
      <span class="badge brand">guillotine 贯通裁切</span>
    </div>
  </header>
  <main class="main">
    <RouterView />
  </main>
</template>
