# 相纸拼版与裁切排版 · Photo Print Imposition Studio

把一批不同尺寸的照片（证件照、5 寸、6 寸、A4）在大张相纸上排满，**保证每一刀都能直线裁到底（guillotine 贯通裁切）**，算出用几张纸、剩余多少、成本多少，并导出 1:1 打印稿与切割步骤清单。

纯前端应用，**没有后端、没有账号、没有任何运行期外网请求**：照片只在浏览器内存里读尺寸与方向，绝不上传。

## 技术栈

- Vue 3 + TypeScript + Vite（全部 `<script setup>` 单文件组件）
- 手写 CSS（无 UI 组件库、无图表库、无游戏引擎、无物理库）
- 状态：Vue 自带 `ref / reactive / computed / watch`（无 Pinia / Vuex）
- 路由：`vue-router`（规格书 §6 要求 6 个页面）
- 依赖仅 `vue` / `vue-router` + 构建工具，**PDF 生成器为手写**（不引入 jsPDF 等库）
- 字体、尺寸库、图片全部本地打包，无 CDN

## 目录结构

```
.
├── Dockerfile                  # node:20-alpine 构建 → nginx:1.27-alpine 运行
├── docker-compose.yml          # 服务名 app-028，端口 8108:80，HEALTHCHECK /healthz
├── nginx.conf                  # SPA 回退 / 哈希资源 immutable / index.html no-cache / gzip
├── .dockerignore  .gitignore
├── index.html  vite.config.ts  tsconfig.json  package.json
├── photo-print-imposition-studio.md   # 规格书（未改动）
└── src
    ├── main.ts  router.ts  store.ts  styles.css  App.vue
    ├── data/papers.json        # 相纸 / 照片尺寸 / 模板 尺寸库
    ├── logic
    │   ├── types.ts            # 数据模型（规格书 §7）
    │   ├── units.ts            # mm / px / pt 换算
    │   ├── guillotine.ts       # 递归二分拆解 + 共边合并 + 逐步贯通校验
    │   ├── packer.ts           # 空闲矩形 + 整边切分（guillotine split）+ best-fit 排样
    │   ├── cost.ts             # 成本核算 + 换纸试算
    │   ├── pdf.ts              # 手写 PDF（1:1 页面 + 照片 JPEG 嵌入 + 中文位图）
    │   ├── png.ts              # 1:1 位图导出（canvas）
    │   ├── csv.ts  image.ts  storage.ts  library.ts
    │   └── selfTest.ts         # 规格书 §10 的自动化断言
    ├── components/             # SheetView / UtilizationBar / RulerScale
    └── views/                  # NewTask / Layout / Cut / Export / Papers / Settings
```

## 本地启动

```bash
npm install
npm run dev          # http://127.0.0.1:5173
# 或
npm run build && npm run preview
```

类型检查与构建：

```bash
npm run typecheck    # vue-tsc --noEmit
npm run build        # vue-tsc --noEmit && vite build
```

## Docker 构建

```bash
docker compose build          # 已验证构建通过
docker compose up -d --build
curl http://localhost:8108/healthz     # -> ok
docker compose down
```

- 构建上下文 **1.57 kB**（不含 `node_modules`、`dist`、任何真实人像照片）
- 镜像 `app-028:1.0.0` 本地 **73.9 MB**，其中应用自身产物 `dist/` 仅约 0.2 MB（3 个哈希文件），体积由规格书指定的 `nginx:1.27-alpine` 基础镜像主导

## 功能

| 规格书 | 实现 |
| --- | --- |
| §4.1 相纸规格 | 8 种内置相纸（4×6 / 5×7 / 6×8 / 8×10 / 12×18 / A4 / A3 / 卷筒），可自定义宽高、纸边留白、单价，可设页眉落款 |
| §4.2 照片清单 | 7 种内置尺寸（1 寸 25×35、小 2 寸 35×45、大 2 寸 35×49、5 寸 89×127、6 寸 102×152、7 寸 127×178、A4），可自定义尺寸、数量、允许旋转、不拆散、「重复排 / 只出现一次」 |
| §4.3 排样 | guillotine 约束 2D 装箱，输出每张纸的 x/y/旋转 + 切割步骤序列 + 利用率 + 总张数 |
| §4.4 刀口与间隙 | 隙距（默认 0 共边）、刀宽补偿（默认 0.5mm，从照片外侧向内缩）、四周安全边（默认 3mm） |
| §4.5 导出与打印 | 1:1 PDF（每张纸一页 + 裁切标记 + 100mm 校验尺 + 切割清单页）、1:1 PNG（150/300/600dpi）、切割清单 CSV、成本表 CSV、浏览器打印视图 |
| §4.6 成本核算 | 单价 → 总材料成本 → 每张照片摊薄 → 与「逐张打印」浪费率对比 |
| §5 进阶 | 多张相纸预览与手工微调（拖动/旋转后增量重校验）、照片文件本地导入、证件照模板一键生成、余料登记与优先使用 |

## 验收结果（规格书 §10）

在浏览器「裁切参数」页点「运行全部断言」即可复现，**7/7 全部通过，控制台无任何 error / warning**：

| # | 验收用例 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| ① | guillotine 合法性：随机 100 组任务每步切割线贯通 | 通过 | 通过 66 组（34 组因尺寸放不下跳过），共校验 **191 张相纸 / 748 刀，无任何反例**；照片均在安全边内、互不重叠 |
| ② | 利用率与张数（误差 ≤1%）、Σ照片面积 ≤ Σ纸张面积 | 通过 | 手工用例 100×100 纸排 4 张 25×25 → 1 张纸 / 利用率 25.00%；8 张 1 寸 → 1 张 5×7 与手工核算一致；31 组随机用例面积守恒 |
| ③ | 安全边 + kerf 向内缩补偿 | 通过 | 40×40mm 照片仍为 40×40mm，切块 42×42mm（每边外扩 kerf/2=1mm），切割线全部落在照片外侧；照片落在 [5, 95]mm 内 |
| ④ | 单位换算：不同 DPI 下 mm 不变；1 寸 = 25×35mm | 通过 | 25mm → 300dpi 295.2756px / 600dpi 590.5512px，往返换算均回到 25mm |
| ⑤ | gap=0 共边合并减少步骤数 | 通过 | 2×2 共边排布：未合并 3 刀 → 合并后 **2 刀** |
| ⑥ | 1:1 导出：PDF 页面 = 相纸尺寸、校验尺 100mm、照片误差 ≤0.5mm | 通过 | PDF 页面 360.00×504.57pt = 127×178mm（**误差 0**）；校验尺线段 42.52pt→325.98pt = **100.00mm**；照片尺寸最大误差 **0.000mm** |
| ⑦ | 性能：500 条目排样 < 500ms；微调增量校验 < 50ms | 通过 | 500 条目排样 **14~15ms**（29 张纸，利用率 76.6%）；手工微调后增量校验 **5.6~6.1ms** |

真实浏览器端到端自测（`npm run dev` + 浏览器实操作业）：

- 套用「证件照 · 1 寸 8 张（5×7 相纸）」→ 排样 → 1 张相纸 / 8 张照片 / 利用率 31.0% / 8 刀（未合并 11 刀，其中 2 刀标记「共边合并」）
- 利用率 31% < 70%，「换纸试算」自动渲染对比表：4×6 英寸 1 张 45.1% ¥1.00 ／ 6×8 英寸 1 张 22.7% ¥2.00 ／ A4 1 张 11.2% ¥2.50
- 拖动照片 → 提示 `guillotine 校验通过：13 刀全部贯通，用时 0.3ms`；点「恢复自动排样」恢复
- 裁切步骤页逐刀高亮 + 播放动画 + 步骤清单可打印
- 导出 PDF（225KB，2 页）、导出切割清单 CSV，均在本机生成并下载
- 打印视图 DOM 校验：2 个 `print-sheet`，inline 宽高分别为 `127mm/178mm` 与 `210mm/297mm`（毫米精确渲染），含 `width: 100mm` 校验尺与「不要勾选『适应页面』」提示
- 全过程 console 无 error / warning，无红色异常提示

## 隐私与本地化

- 照片文件通过 `URL.createObjectURL` 只在本机内存中读取，**不上传、不写入 localStorage、不进镜像**
- 任务/尺寸库/余料存 `localStorage`，照片本身不落盘
- 尺寸库 `src/data/papers.json` 与中文字体（使用系统本地字体栈）均本地打包，无外网 CDN、无运行期外网请求（断网可用）

## 已知限制

- 手写 PDF 内置的西文字体无法显示中文，因此 PDF 中的中文说明（切割清单页、页眉落款）以 300dpi 位图形式嵌入；如需纯文本中文，请用浏览器「打印视图」输出
- 手工微调只允许在安全边内移动，且移动后必须仍满足 guillotine 贯通裁切，否则导出会被停用并给出原因
- 同一任务导入的底片数量超过 60 张时，PDF 只导出编号排版而不嵌入照片，避免文件过大
