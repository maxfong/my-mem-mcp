# 构建阶段
# 如果 docker.io 无法访问，可替换为: docker.1ms.run/library/node:20-alpine
# FROM node:20-alpine AS builder
FROM docker.1ms.run/library/node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装所有依赖（包括 devDependencies 用于编译）
RUN npm ci

# 复制源代码
COPY tsconfig.json ./
COPY src ./src

# 编译 TypeScript
RUN npm run build

# 运行阶段
# FROM node:20-alpine
FROM docker.1ms.run/library/node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --only=production && npm cache clean --force

# 复制编译后的代码
COPY --from=builder /app/dist ./dist

# 创建数据目录
RUN mkdir -p /app/data

# 设置环境变量默认值
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV EMBEDDING_MODEL=bge-m3
ENV DATA_DIR=/app/data
ENV LOG_PATH=/app/data/calls.log
ENV LOG_ENABLED=true

# 入口点
CMD ["node", "dist/index.js"]
