import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { CallLog } from './types.js';

/**
 * 日志文件路径
 */
const LOG_PATH = process.env.LOG_PATH || './data/calls.log';

/**
 * 是否启用日志
 */
const LOG_ENABLED = process.env.LOG_ENABLED !== 'false';

/**
 * 确保日志目录存在
 */
function ensureLogDir(): void {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 格式化日志输出
 */
function formatLog(log: CallLog): string {
  const status = log.success ? '✓' : '✗';
  const errorInfo = log.error ? ` | Error: ${log.error}` : '';
  
  return `[${log.timestamp}] ${status} ${log.method} (${log.duration}ms)${errorInfo}
  Request: ${JSON.stringify(log.request)}
  Response: ${JSON.stringify(log.response)}
${'─'.repeat(80)}
`;
}

/**
 * 记录调用日志
 * @param method 方法名
 * @param request 请求参数
 * @param response 响应数据
 * @param duration 执行耗时
 * @param success 是否成功
 * @param error 错误信息
 */
export function logCall(
  method: string,
  request: unknown,
  response: unknown,
  duration: number,
  success: boolean,
  error?: string
): void {
  if (!LOG_ENABLED) return;

  const log: CallLog = {
    timestamp: new Date().toISOString(),
    method,
    request,
    response,
    duration,
    success,
    error
  };

  // 输出到 stderr（Docker logs 可见）
  console.error(formatLog(log));

  // 同时写入日志文件
  try {
    ensureLogDir();
    appendFileSync(LOG_PATH, formatLog(log), 'utf-8');
  } catch (err) {
    console.error('[Logger] 写入日志文件失败:', err);
  }
}

/**
 * 创建计时器，用于计算执行时间
 */
export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
