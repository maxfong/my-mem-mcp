# My-Mem-MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![Vibe Coding](https://img.shields.io/badge/Built%20with-Vibe%20Coding-ff69b4.svg)](https://github.com/maxfong/my-mem-mcp)

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的记忆存储服务，支持问答形式的数据存储与语义搜索。使用 Ollama + BGE-M3 进行向量化，实现高效的语义匹配。

> 🎵 本项目使用 **Vibe Coding** 方式开发 - 在轻松愉快的氛围中，与 AI 协作完成编码。

## 功能特性

- **add_message** - 添加问答记忆，自动生成向量嵌入
- **search_message** - 语义搜索相关记忆，返回相似度分数
- **delete_message** - 删除指定记忆

**其他特性：**

- 多用户数据隔离（每个用户独立存储）
- 支持 STDIO 和 SSE 两种传输模式
- JSON 文件持久化存储
- 调用日志记录

## 快速开始

### 前置条件

- Docker 和 Docker Compose
- [Ollama](https://ollama.ai/) 运行中，并安装 BGE-M3 模型

```bash
# 安装 BGE-M3 模型
ollama pull bge-m3
```

### Docker 部署

```bash
# 克隆项目
git clone https://github.com/maxfong/my-mem-mcp.git
cd my-mem-mcp

# 启动服务
docker-compose up -d
```

服务启动后：
- SSE 端点: `http://localhost:9501/sse/{userId}`
- 健康检查: `http://localhost:9501/health`

## MCP 配置

### Cursor

编辑 Cursor 的 MCP 配置文件：

**SSE 模式（推荐）：**

```json
{
  "mcpServers": {
    "my-mem-mcp": {
      "url": "http://localhost:9501/sse/your-user-id"
    }
  }
}
```

**STDIO 模式：**

```json
{
  "mcpServers": {
    "my-mem-mcp": {
      "command": "docker",
      "args": ["exec", "-i", "my-mem-mcp", "node", "dist/index.js"]
    }
  }
}
```

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "my-mem-mcp": {
      "url": "http://localhost:9501/sse/your-user-id"
    }
  }
}
```

### Docker 容器内调用

如果你的应用也运行在 Docker 容器中，需要使用 Docker 网络进行通信：

**同一 docker-compose 网络：**

```json
{
  "mcpServers": {
    "my-mem-mcp": {
      "url": "http://my-mem-mcp:9501/sse/your-user-id"
    }
  }
}
```

**跨 Docker 网络（使用宿主机 IP）：**

```json
{
  "mcpServers": {
    "my-mem-mcp": {
      "url": "http://host.docker.internal:9501/sse/your-user-id"
    }
  }
}
```

> **注意：** 
> - `my-mem-mcp` 是容器名称，同一 docker-compose 网络内可直接使用
> - `host.docker.internal` 在 macOS/Windows 的 Docker Desktop 中可用，Linux 需要额外配置
> - 确保端口 `9501` 已正确映射

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama 服务地址 |
| `EMBEDDING_MODEL` | `bge-m3` | 向量嵌入模型 |
| `DATA_DIR` | `/app/data` | 数据存储目录 |
| `TRANSPORT_MODE` | `stdio` | 传输模式：`stdio` 或 `sse` |
| `SSE_PORT` | `3000` | SSE 服务端口 |
| `DEFAULT_USER_ID` | - | 默认用户 ID（可选） |
| `LOG_ENABLED` | `true` | 是否启用日志 |
| `LOG_PATH` | `/app/data/calls.log` | 日志文件路径 |

## 项目结构

```
my-mem-mcp/
├── src/
│   ├── index.ts              # MCP 服务入口
│   ├── memory-store.ts       # 记忆存储核心
│   ├── ollama-client.ts      # Ollama API 封装
│   ├── vector-search.ts      # 向量搜索算法
│   ├── logger.ts             # 日志工具
│   └── types.ts              # 类型定义
├── data/                     # 数据存储（自动创建）
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## API 接口

### add_message

添加一条问答记忆。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | 否* | 用户 ID，用于数据隔离 |
| `question` | string | 是 | 问题内容 |
| `answer` | string | 是 | 答案内容 |

*如果通过 URL 路径或环境变量配置了用户 ID，则此参数可省略。

### search_message

搜索相关记忆，返回语义最相似的结果。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | 否* | 用户 ID |
| `query` | string | 是 | 搜索查询内容 |
| `limit` | number | 否 | 返回数量限制，默认 5 |

### delete_message

删除指定的记忆。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | 否* | 用户 ID |
| `id` | string | 是 | 记忆 ID |

## 本地开发

```bash
# 安装依赖
npm install

# 编译
npm run build

# 运行（STDIO 模式）
npm start

# 运行（SSE 模式）
TRANSPORT_MODE=sse SSE_PORT=9501 npm start
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 18+ |
| 语言 | TypeScript |
| MCP SDK | @modelcontextprotocol/sdk |
| 向量生成 | Ollama + BGE-M3 |
| 数据存储 | JSON 文件 |
| 容器化 | Docker |

## 许可证

[MIT](LICENSE)
