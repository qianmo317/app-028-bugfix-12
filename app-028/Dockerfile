# ---------- 构建阶段 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先装依赖（package-lock.json 必须保留，保证可复现）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 再拷源码构建（字体/尺寸库全部本地打包，无任何外网请求）
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
