# 相纸拼版与裁切排版 · Photo Print Imposition Studio

> 类型：前端 Web 应用（纯前端）｜难度：★★★｜技术栈：**Vue 3 + TypeScript + Vite**（`<script setup>` 单文件组件；自写 2D 排样；禁用 UI 组件库与图表库，见 README §5.1）

## 1. 一句话简介
把一批不同尺寸的照片（证件照、5 寸、6 寸、A4）在大张相纸上排满，保证每一刀都能直线裁到底，算出用几张纸、剩余多少，导出 1:1 打印稿。

## 2. 真实场景与痛点
- 照相馆冲印是**按张数摊薄成本**的：一张 12×18 英寸相纸只印一张 6 寸就浪费 90%，会排版的师傅能把成本压掉一半。
- 证件照更典型：一张相纸上要排 8 张 1 寸 + 8 张 2 寸 + 2 张 5 寸，尺寸混排最容易出错。
- **相纸只能直线裁切（裁刀/铡刀）**：想怎么摆就怎么摆的排样是没用的，必须保证每条切割线贯通到底（guillotine 切割），否则裁不出来。
- 尺寸换算混乱：英寸相纸、毫米照片、300dpi 像素三套单位，换算错一次就整张报废。
- 忘了留裁切边距，照片被裁掉一条边。

## 3. 目标用户
- 照相馆/影楼冲印师、证件照门店。
- 学校/单位批量打印证件照的人事与行政。
- 手账与照片墙爱好者（自己排版打印）。

## 4. 核心功能（MVP）
1. **相纸规格**：内置常见相纸（`4×6"`、`5×7"`、`6×8"`、`8×10"`、`12×18"`、A4、A3、卷筒自定义宽）；可自定义；可设置纸边留白与页眉落款。
2. **照片清单**：内置常见尺寸（1 寸 25×35、小 2 寸 35×45、大 2 寸 35×49、5 寸 89×127、6 寸 102×152、7 寸 127×178、A4）；自定义尺寸；数量；可选「同一张照片重复排」与「一张照片只出现一次」。
3. **排样（核心）**：guillotine 约束下的 2D 装箱，输出每张相纸上的照片位置（x/y/旋转）、**切割步骤序列**（每一步切哪条线）、利用率与总张数。
4. **裁切刀口与间隙**：相邻照片间距（默认 0，共边裁切）、最小裁切余量（刀宽补偿，默认 0.5mm）、四周安全边（默认 3mm）。
5. **导出与打印**：1:1 PDF/图片（含裁切标记线与 100mm 校验尺）、排样示意图（带编号，方便对照）、切割步骤清单（哪一步裁哪条）。
6. **成本核算**：每张相纸单价 → 总材料成本 → 每张照片摊薄成本；对比「不排样逐张打印」的浪费率。

## 5. 进阶功能
- 多张相纸的排样结果预览与手工微调（拖动/旋转后重新校验 guillotine 合法性）。
- 照片实际文件导入（只读尺寸与方向，**不上传服务器**，纯本地处理）。
- 证件照背景与排版模板（1 寸 8 张、2 寸 4 张等常用模板一键生成）。
- 余料登记（剩余纸边尺寸记录下来，下次优先用余料）。

## 6. 页面结构
```
/                 新建任务（相纸 + 照片清单）
/layout/:id       排样预览（纸面视图、编号、利用率、张数）
/cut/:id          裁切步骤（逐步高亮切割线 + 步骤清单）
/export/:id       导出（PDF / 图片 / 排样图 / 成本表）
/papers           相纸与照片尺寸库
/settings         裁切参数（隙距、刀宽补偿、安全边）
```

## 7. 数据模型
```ts
type Paper = { id: string; name: string; wMm: number; hMm: number; marginMm: number; priceCents: number };
type PhotoSize = { id: string; name: string; wMm: number; hMm: number; /* 1 寸=25×35 等 */ };
type Item = { sizeId: string; qty: number; rotateAllowed: boolean; keepTogether: boolean };
type Placement = { itemId: string; sheetIndex: number; x: number; y: number; w: number; h: number;
                   rotated: boolean; seq: number };
type CutStep = { sheetIndex: number; axis: 'v'|'h'; at: number; from: number; to: number;
                 /* 贯通切割线 */ };
type Sheet = { index: number; placements: Placement[]; cutSteps: CutStep[];
               usedAreaMm2: number; sheetAreaMm2: number; utilization: number };
type Task = { id: string; paperId: string; items: Item[]; gapMm: number; kerfMm: number;
              safeEdgeMm: number; allowRotate: boolean; result?: { sheets: Sheet[]; totalCents: number } };
```

## 8. 关键实现点
- **必须满足 guillotine 约束（本工具的核心差异点）**：排样不能自由摆放，必须能通过一系列「整条直线切割」把纸分成各个照片矩形。实现上使用 **shelf（分层）+ best-fit 且只在整行/整列边界切分** 的策略，或者用「递归二分（guillotine split）」：
  ```
  pack(rect): 在剩余矩形中选最合适的放置点 → 放置后把剩余区域沿
  一条整边切成两个子矩形 → 递归；不允许"夹缝塞入"式的自由放置
  ```
  实现后必须验证：**遍历每一步切割，切割线必须完全贯通当前矩形**（有自动化断言，这是最容易写错的地方）。
- **单位统一 mm**；像素只在导出时按 DPI 换算（`px = mm / 25.4 × dpi`），**同一物理尺寸在不同 DPI 下 mm 不变**（断言）。
- **旋转**：`rotateAllowed` 为真时才允许 90° 旋转；证件照默认不允许旋转（方向有要求）。
- **利用率与张数**：`利用率 = Σ照片面积 / (纸宽×纸高)`，张数由排样结果决定（不是估算）；结果必须满足 `Σ所有 placement 面积 ≤ Σ纸张面积`（断言）。
- **共边裁切与刃宽补偿**：`gapMm = 0` 时相邻照片共边，切割步骤要合并成一条线（减少裁切次数）；`kerfMm` 从照片尺寸外侧补偿（向内缩），**不是简单加间距**。
- **安全边**：所有 placement 必须落在 `[margin, W - margin]` 范围内（断言），否则裁到边。
- **性能**：500 个照片条目排样 < 500ms；手工微调后重新校验 < 50ms（增量校验而非全量重排）。

## 9. 交互与视觉要点
- 纸面视图用毫米网格 + 照片缩略图占位，每张照片编号（与清单对应，方便对号入座）。
- 切割步骤视图：逐步高亮当前切割线（灰→红），可播放动画；步骤清单可打印贴在裁切台。
- 利用率用进度条 + 数字双显示，低于 70% 给「换更大/更小纸张试试」的提示（自动试算 2~3 种规格对比）。
- 打印视图必须提示关闭「适应页面」，并显示 100mm 校验尺。

## 10. 验收标准
- **guillotine 合法性**：随机 100 组任务，每个排样结果的每一步切割线都贯通当前矩形（自动化断言，不许有反例）。
- 利用率与张数：与手工核算一致（误差 ≤ 1%）；`Σ照片面积 ≤ Σ纸张面积`。
- 安全边：所有照片落在边距内（断言）；`kerf` 补偿方向正确（向内缩）。
- 单位换算：300dpi 与 600dpi 下同一照片的 mm 尺寸不变（断言）；1 寸 = 25×35mm 换算正确。
- 共边裁切：`gap=0` 时相邻共边照片的切割步骤合并为一条线（断言步骤数减少）。
- 1:1 导出 PDF 打印后校验尺误差 ≤ 1mm，照片尺寸误差 ≤ 0.5mm。
- 500 条目排样 < 500ms。

## 11. 边界（刻意不做）
不做在线冲印下单与支付、不做云相册与照片分享、不做修图与滤镜、不做订单管理——核心只做**拼版排样 + 裁切步骤 + 1:1 导出 + 成本核算**，避开黑名单中的电商订单、支付、分享方向。

## 12. 容器化与构建（Docker）

- **Dockerfile（多阶段）**：`node:20-alpine` 构建 → `nginx:1.27-alpine` 只拷 `dist/` 与 `nginx.conf`
- **docker-compose.yml**：服务名 `app-028`，端口 **`8108:80`**，`restart: unless-stopped`；`HEALTHCHECK` 请求 `/healthz`
- **nginx.conf**：SPA 回退；哈希资源 `immutable`；`index.html` no-cache；gzip
- **无后端**：照片只在本机内存里读尺寸，**不上传**（README 要写明这一点）
- 尺寸库与中文字体本地打包

```bash
cd frontend/app-028
docker compose up -d --build
curl http://localhost:8108/healthz
docker compose down
```

- **验收**：`http://localhost:8108` 完成「选相纸 → 加照片清单 → 排样 → 看切割步骤 → 导出 PDF」；断网可用；镜像 < 60MB。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**：`node_modules`、`dist`、`.git`、`.gitignore`、`.env`、`.env.*`、`*.log`、`coverage`、`.vscode`、`.idea`、`Dockerfile`、`nginx.conf`、`README.md`
  - `node_modules` 必须排除；**保留** `package-lock.json`、`src/data/papers.json`（相纸与照片尺寸库）
  - 忽略本地测试照片（`tests/fixtures/*.jpg` 只留 2 张小样本）
- **`.gitignore`**：`node_modules/`、`dist/`、`.env*`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`，另排**客户照片与导出稿** `photos/`、`exports/`、`*.pdf`（含人像隐私，绝不入库）
- **自检**：构建上下文 < 5MB 且**不含任何真实人像照片**（断言）；`git status` 不出现 `.env`、客户照片与导出 PDF
