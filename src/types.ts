/**
 * 记忆数据结构
 */
export interface Memory {
  /** 唯一标识符 */
  id: string;
  /** 用户ID（用于数据隔离） */
  userId: string;
  /** 问题 */
  question: string;
  /** 答案 */
  answer: string;
  /** 向量嵌入 (BGE-M3: 1024维) */
  embedding: number[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 存储文件结构
 */
export interface MemoryData {
  /** 记忆列表 */
  memories: Memory[];
  /** 数据版本 */
  version: number;
  /** 最后更新时间 */
  lastUpdated: string;
}

/**
 * 搜索结果（带相似度分数）
 */
export interface SearchResult {
  /** 记忆数据 */
  memory: Memory;
  /** 相似度分数 (0-1) */
  score: number;
}

/**
 * 添加记忆的参数
 */
export interface AddMemoryParams {
  userId?: string;
  question: string;
  answer: string;
}

/**
 * 搜索记忆的参数
 */
export interface SearchMemoryParams {
  userId?: string;
  query: string;
  limit?: number;
}

/**
 * 删除记忆的参数
 */
export interface DeleteMemoryParams {
  userId?: string;
  id: string;
}

/**
 * 调用日志结构
 */
export interface CallLog {
  /** 时间戳 */
  timestamp: string;
  /** 调用的方法名 */
  method: string;
  /** 请求参数 */
  request: unknown;
  /** 响应数据 */
  response: unknown;
  /** 执行耗时(ms) */
  duration: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}
