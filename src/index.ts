#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';

import { memoryStore } from './memory-store.js';
import { checkOllamaHealth, getOllamaHost, getEmbeddingModel } from './ollama-client.js';
import { logCall, startTimer } from './logger.js';
import type { AddMemoryParams, SearchMemoryParams, DeleteMemoryParams } from './types.js';

/**
 * 解析命令行参数
 * 支持格式: userId=xxx 或 userId xxx
 */
function parseArgs(): { userId?: string } {
  const args = process.argv.slice(2);
  let userId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('userId=')) {
      userId = arg.split('=')[1];
    } else if (arg === 'userId' && args[i + 1]) {
      userId = args[i + 1];
      i++;
    }
  }

  return { userId };
}

const parsedArgs = parseArgs();

/**
 * 全局默认用户ID（用于 STDIO 模式）
 * 优先级: 命令行参数 > 环境变量
 */
const GLOBAL_DEFAULT_USER_ID = parsedArgs.userId || process.env.DEFAULT_USER_ID || '';

/**
 * 创建获取有效用户ID的函数
 * @param sessionUserId 会话级别的用户ID（SSE 模式通过 URL 参数传入）
 */
function createGetEffectiveUserId(sessionUserId?: string) {
  return (paramUserId?: string): string | undefined => {
    // 优先级: 会话级别 > 全局默认 > 接口参数
    if (sessionUserId) {
      return sessionUserId;
    }
    if (GLOBAL_DEFAULT_USER_ID) {
      return GLOBAL_DEFAULT_USER_ID;
    }
    return paramUserId;
  };
}

/**
 * 生成 userId 参数的描述
 */
function getUserIdDescription(sessionUserId?: string): string {
  if (sessionUserId) {
    return `用户ID，用于数据隔离。当前会话已配置用户: ${sessionUserId}，接口传入的 userId 将被忽略`;
  }
  if (GLOBAL_DEFAULT_USER_ID) {
    return `用户ID，用于数据隔离。当前服务端已配置默认用户: ${GLOBAL_DEFAULT_USER_ID}，接口传入的 userId 将被忽略`;
  }
  return '用户ID，用于数据隔离。如果服务端配置了 DEFAULT_USER_ID 环境变量，则此参数可省略';
}

/**
 * 创建 MCP 服务器实例
 * @param sessionUserId 会话级别的用户ID
 */
function createServer(sessionUserId?: string): Server {
  const server = new Server(
    {
      name: 'my-mem-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const getEffectiveUserId = createGetEffectiveUserId(sessionUserId);
  const userIdDescription = getUserIdDescription(sessionUserId);

  /**
   * 定义可用的工具列表
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'add_message',
          description: '添加一条问答记忆。将问题和答案以向量形式存储，支持后续语义搜索。每个用户的数据相互隔离。',
          inputSchema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: userIdDescription,
              },
              question: {
                type: 'string',
                description: '问题内容',
              },
              answer: {
                type: 'string',
                description: '答案内容',
              },
            },
            required: ['question', 'answer'],
          },
        },
        {
          name: 'search_message',
          description: '搜索相关记忆。使用语义搜索找到与查询最相关的问答记录。只搜索指定用户的数据。',
          inputSchema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: userIdDescription,
              },
              query: {
                type: 'string',
                description: '搜索查询内容',
              },
              limit: {
                type: 'number',
                description: '返回结果数量限制，默认为 5',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'delete_message',
          description: '删除指定的记忆。通过 ID 删除一条记忆记录。只能删除自己的数据。',
          inputSchema: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: userIdDescription,
              },
              id: {
                type: 'string',
                description: '要删除的记忆 ID',
              },
            },
            required: ['id'],
          },
        },
      ],
    };
  });

  /**
   * 处理工具调用
   */
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    const timer = startTimer();

    try {
      let result;

      switch (name) {
        case 'add_message': {
          const params = args as unknown as AddMemoryParams;
          const userId = getEffectiveUserId(params.userId);
          
          if (!userId || !params.question || !params.answer) {
            const errorResponse = {
              content: [
                {
                  type: 'text',
                  text: '错误：userId、question 和 answer 是必填参数（userId 可通过 URL 参数或环境变量配置）',
                },
              ],
              isError: true,
            };
            logCall(name, { ...params, userId }, errorResponse, timer(), false, '缺少必填参数');
            return errorResponse;
          }

          const memory = await memoryStore.add(
            userId,
            params.question,
            params.answer
          );

          result = {
            success: true,
            message: '记忆已添加',
            id: memory.id,
            userId: memory.userId,
            question: memory.question,
            answer: memory.answer,
            createdAt: memory.createdAt,
          };

          const response = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };

          logCall(name, { userId, question: params.question, answer: params.answer }, result, timer(), true);
          return response;
        }

        case 'search_message': {
          const params = args as unknown as SearchMemoryParams;
          const userId = getEffectiveUserId(params.userId);
          
          if (!userId || !params.query) {
            const errorResponse = {
              content: [
                {
                  type: 'text',
                  text: '错误：userId 和 query 是必填参数（userId 可通过 URL 参数或环境变量配置）',
                },
              ],
              isError: true,
            };
            logCall(name, { ...params, userId }, errorResponse, timer(), false, '缺少必填参数');
            return errorResponse;
          }

          const results = await memoryStore.search(
            userId,
            params.query,
            params.limit || 5
          );

          // 格式化搜索结果（不返回 embedding）
          const formattedResults = results.map(r => ({
            id: r.memory.id,
            userId: r.memory.userId,
            question: r.memory.question,
            answer: r.memory.answer,
            score: Math.round(r.score * 100) / 100,
            createdAt: r.memory.createdAt,
          }));

          result = {
            success: true,
            userId: userId,
            query: params.query,
            count: formattedResults.length,
            results: formattedResults,
          };

          const response = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };

          logCall(name, { userId, query: params.query, limit: params.limit }, result, timer(), true);
          return response;
        }

        case 'delete_message': {
          const params = args as unknown as DeleteMemoryParams;
          const userId = getEffectiveUserId(params.userId);
          
          if (!userId || !params.id) {
            const errorResponse = {
              content: [
                {
                  type: 'text',
                  text: '错误：userId 和 id 是必填参数（userId 可通过 URL 参数或环境变量配置）',
                },
              ],
              isError: true,
            };
            logCall(name, { ...params, userId }, errorResponse, timer(), false, '缺少必填参数');
            return errorResponse;
          }

          const success = await memoryStore.delete(userId, params.id);

          result = {
            success,
            message: success ? '记忆已删除' : '未找到该记忆或无权删除',
            userId: userId,
            id: params.id,
          };

          const response = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };

          logCall(name, { userId, id: params.id }, result, timer(), success, success ? undefined : '记忆不存在或无权限');
          return response;
        }

        default: {
          const errorResponse = {
            content: [
              {
                type: 'text',
                text: `未知工具: ${name}`,
              },
            ],
            isError: true,
          };
          logCall(name, args, errorResponse, timer(), false, `未知工具: ${name}`);
          return errorResponse;
        }
      }
    } catch (error) {
      const err = error as Error;
      const errorResponse = {
        content: [
          {
            type: 'text',
            text: `执行错误: ${err.message}`,
          },
        ],
        isError: true,
      };
      logCall(name, args, errorResponse, timer(), false, err.message);
      return errorResponse;
    }
  });

  return server;
}

/**
 * 获取传输模式
 * 支持: stdio (默认), sse
 */
function getTransportMode(): 'stdio' | 'sse' {
  const mode = process.env.TRANSPORT_MODE?.toLowerCase();
  if (mode === 'sse') return 'sse';
  return 'stdio';
}

/**
 * 获取 SSE 服务端口
 */
function getSSEPort(): number {
  return parseInt(process.env.SSE_PORT || '3000', 10);
}

/**
 * 打印启动信息
 */
async function printStartupInfo() {
  console.error('='.repeat(60));
  console.error('My-Mem-MCP 服务启动中...');
  console.error('='.repeat(60));
  
  // 检查 Ollama 服务
  const ollamaHealthy = await checkOllamaHealth();
  if (ollamaHealthy) {
    console.error(`[Ollama] 服务正常: ${getOllamaHost()}`);
    console.error(`[Ollama] 嵌入模型: ${getEmbeddingModel()}`);
  } else {
    console.error(`[Ollama] 警告: 无法连接到 ${getOllamaHost()}`);
    console.error('[Ollama] 请确保 Ollama 服务正在运行');
  }

  console.error(`[Memory] 当前记忆总数: ${memoryStore.count()}`);
  console.error(`[Memory] 用户数量: ${memoryStore.getUsers().length}`);
  if (GLOBAL_DEFAULT_USER_ID) {
    const source = parsedArgs.userId ? '命令行参数' : '环境变量';
    console.error(`[Config] 全局默认用户ID: ${GLOBAL_DEFAULT_USER_ID} (来源: ${source})`);
  } else {
    console.error(`[Config] 未设置全局默认用户ID`);
  }
  console.error(`[Logger] 日志已启用，输出到 stderr 和 data/calls.log`);
  console.error('='.repeat(60));
}

/**
 * 以 STDIO 模式启动服务器
 */
async function startStdioServer() {
  await printStartupInfo();
  
  // STDIO 模式使用全局默认用户ID或命令行参数
  const server = createServer(GLOBAL_DEFAULT_USER_ID || undefined);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[MCP] STDIO 模式服务已启动，等待连接...');
}

/**
 * SSE 会话信息
 */
interface SSESession {
  transport: SSEServerTransport;
  server: Server;
  userId?: string;
}

/**
 * 以 SSE 模式启动服务器
 */
async function startSSEServer() {
  await printStartupInfo();
  
  const port = getSSEPort();
  
  // 存储活跃的 SSE 会话（sessionId -> SSESession）
  const sessions = new Map<string, SSESession>();
  
  const httpServer = http.createServer(async (req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    
    // 健康检查端点
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        mode: 'sse', 
        port,
        activeSessions: sessions.size 
      }));
      return;
    }
    
    // SSE 连接端点：支持 /sse 或 /sse/{userId}
    if ((url.pathname === '/sse' || url.pathname.startsWith('/sse/')) && req.method === 'GET') {
      // 从 URL 路径或查询参数获取 userId
      // 支持: /sse/miaomiao 或 /sse?userId=miaomiao
      let userId: string | undefined;
      
      // 先检查路径参数 /sse/{userId}
      const pathMatch = url.pathname.match(/^\/sse\/(.+)$/);
      if (pathMatch) {
        userId = decodeURIComponent(pathMatch[1]);
      }
      
      // 如果路径没有，再检查查询参数
      if (!userId) {
        userId = url.searchParams.get('userId') || undefined;
      }
      
      // 生成唯一的 sessionId
      const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
      
      console.error(`[SSE] 新客户端连接, sessionId: ${sessionId}${userId ? `, userId: ${userId}` : ''}`);
      
      // 为每个会话创建独立的 Server 实例
      const server = createServer(userId);
      // 使用带 sessionId 的消息端点，确保消息路由正确
      const transport = new SSEServerTransport(`/messages/${sessionId}`, res);
      
      sessions.set(sessionId, { transport, server, userId });
      
      res.on('close', () => {
        console.error(`[SSE] 客户端断开连接, sessionId: ${sessionId}${userId ? `, userId: ${userId}` : ''}`);
        sessions.delete(sessionId);
      });
      
      await server.connect(transport);
      return;
    }
    
    // 消息接收端点：/messages/{sessionId}
    const messagesMatch = url.pathname.match(/^\/messages\/([a-z0-9]+)$/);
    if (messagesMatch && req.method === 'POST') {
      const sessionId = messagesMatch[1];
      const session = sessions.get(sessionId);
      
      if (!session) {
        console.error(`[SSE] 未找到会话: ${sessionId}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found', sessionId }));
        return;
      }
      
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          await session.transport.handlePostMessage(req, res, body);
        } catch (error) {
          console.error(`[SSE] 消息处理错误 (sessionId: ${sessionId}):`, error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        }
      });
      return;
    }
    
    // 404
    res.writeHead(404);
    res.end('Not Found');
  });
  
  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`[MCP] SSE 模式服务已启动`);
    console.error(`[MCP] 监听地址: http://0.0.0.0:${port}`);
    console.error(`[MCP] SSE 端点: http://0.0.0.0:${port}/sse/{userId} 或 http://0.0.0.0:${port}/sse?userId=xxx`);
    console.error(`[MCP] 消息端点: http://0.0.0.0:${port}/messages/{sessionId}`);
    console.error(`[MCP] 健康检查: http://0.0.0.0:${port}/health`);
  });
}

/**
 * 启动服务器
 */
async function main() {
  const mode = getTransportMode();
  
  if (mode === 'sse') {
    await startSSEServer();
  } else {
    await startStdioServer();
  }
}

// 启动
main().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});
