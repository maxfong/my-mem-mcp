import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Memory, MemoryData, SearchResult } from './types.js';
import { generateEmbedding } from './ollama-client.js';
import { searchSimilar, filterByThreshold } from './vector-search.js';

/**
 * 数据目录路径
 */
const DATA_DIR = process.env.DATA_DIR || './data';

/**
 * 相似度阈值（低于此值的结果会被过滤）
 */
const SIMILARITY_THRESHOLD = 0.5;

/**
 * 记忆存储管理类
 * 每个用户的数据存储在独立的 JSON 文件中: data/{userId}.json
 * 支持并发访问，通过写入锁保证数据一致性
 */
class MemoryStore {
  /** 内存缓存: userId -> Memory[] */
  private cache: Map<string, Memory[]> = new Map();
  private dataDir: string;
  
  /** 写入锁: userId -> Promise，用于防止并发写入冲突 */
  private writeLocks: Map<string, Promise<void>> = new Map();

  constructor(dataDir: string = DATA_DIR) {
    this.dataDir = dataDir;
    this.ensureDataDir();
    this.loadAllUsers();
  }
  
  /**
   * 获取用户写入锁
   * 确保同一用户的写入操作串行执行
   */
  private async acquireWriteLock(userId: string): Promise<() => void> {
    // 等待当前锁释放
    const currentLock = this.writeLocks.get(userId);
    if (currentLock) {
      await currentLock;
    }
    
    // 创建新的锁
    let releaseLock: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.writeLocks.set(userId, newLock);
    
    return releaseLock!;
  }

  /**
   * 确保数据目录存在
   */
  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 获取用户数据文件路径
   */
  private getUserFilePath(userId: string): string {
    // 清理 userId，避免路径注入
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dataDir, `${safeUserId}.json`);
  }

  /**
   * 加载所有用户数据到缓存
   */
  private loadAllUsers(): void {
    try {
      const files = readdirSync(this.dataDir).filter(f => f.endsWith('.json') && f !== 'calls.log');
      let totalMemories = 0;

      for (const file of files) {
        const userId = file.replace('.json', '');
        const memories = this.loadUser(userId);
        totalMemories += memories.length;
      }

      console.error(`[MemoryStore] 已加载 ${this.cache.size} 个用户，共 ${totalMemories} 条记忆`);
    } catch (error) {
      console.error('[MemoryStore] 加载用户数据失败:', error);
    }
  }

  /**
   * 加载单个用户数据
   */
  private loadUser(userId: string): Memory[] {
    const filePath = this.getUserFilePath(userId);
    
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const data: MemoryData = JSON.parse(raw);
        const memories = data.memories || [];
        this.cache.set(userId, memories);
        return memories;
      }
    } catch (error) {
      console.error(`[MemoryStore] 加载用户 ${userId} 数据失败:`, error);
    }
    
    return [];
  }

  /**
   * 获取用户的记忆列表（如果未缓存则加载）
   */
  private getUserMemories(userId: string): Memory[] {
    if (!this.cache.has(userId)) {
      this.loadUser(userId);
    }
    return this.cache.get(userId) || [];
  }

  /**
   * 保存用户数据到文件
   */
  private saveUser(userId: string): void {
    try {
      const filePath = this.getUserFilePath(userId);
      const memories = this.cache.get(userId) || [];

      const data: MemoryData = {
        memories,
        version: 1,
        lastUpdated: new Date().toISOString()
      };

      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[MemoryStore] 保存用户 ${userId} 数据失败:`, error);
      throw error;
    }
  }

  /**
   * 添加一条记忆
   * @param userId 用户ID
   * @param question 问题
   * @param answer 答案
   * @returns 新创建的记忆
   */
  async add(userId: string, question: string, answer: string): Promise<Memory> {
    // 组合问题和答案生成向量（在获取锁之前完成，避免长时间持有锁）
    const text = `问题: ${question}\n答案: ${answer}`;
    const embedding = await generateEmbedding(text);

    const now = new Date().toISOString();
    const memory: Memory = {
      id: uuidv4(),
      userId,
      question,
      answer,
      embedding,
      createdAt: now,
      updatedAt: now
    };

    // 获取写入锁，确保并发安全
    const releaseLock = await this.acquireWriteLock(userId);
    
    try {
      // 获取用户记忆列表并添加
      const userMemories = this.getUserMemories(userId);
      userMemories.push(memory);
      this.cache.set(userId, userMemories);
      this.saveUser(userId);

      console.error(`[MemoryStore] 已添加记忆: ${memory.id} (用户: ${userId}, 文件: ${userId}.json)`);
      return memory;
    } finally {
      releaseLock();
    }
  }

  /**
   * 搜索相关记忆（按用户隔离）
   * @param userId 用户ID
   * @param query 查询文本
   * @param limit 返回数量限制
   * @returns 搜索结果列表
   */
  async search(userId: string, query: string, limit: number = 5): Promise<SearchResult[]> {
    // 获取该用户的记忆
    const userMemories = this.getUserMemories(userId);
    
    if (userMemories.length === 0) {
      console.error(`[MemoryStore] 用户 ${userId} 没有记忆数据`);
      return [];
    }

    // 生成查询向量
    const queryEmbedding = await generateEmbedding(query);

    // 搜索相似记忆
    const results = searchSimilar(queryEmbedding, userMemories, limit * 2);

    // 过滤低相似度结果
    const filtered = filterByThreshold(results, SIMILARITY_THRESHOLD);

    console.error(`[MemoryStore] 搜索 "${query}" (用户: ${userId}) 找到 ${filtered.length} 条相关记忆`);
    return filtered.slice(0, limit);
  }

  /**
   * 删除指定记忆（需验证用户归属）
   * @param userId 用户ID
   * @param id 记忆ID
   * @returns 是否删除成功
   */
  async delete(userId: string, id: string): Promise<boolean> {
    // 获取写入锁，确保并发安全
    const releaseLock = await this.acquireWriteLock(userId);
    
    try {
      const userMemories = this.getUserMemories(userId);
      const index = userMemories.findIndex(m => m.id === id);
      
      if (index === -1) {
        console.error(`[MemoryStore] 未找到记忆: ${id} (用户: ${userId})`);
        return false;
      }

      userMemories.splice(index, 1);
      this.cache.set(userId, userMemories);
      this.saveUser(userId);

      console.error(`[MemoryStore] 已删除记忆: ${id} (用户: ${userId})`);
      return true;
    } finally {
      releaseLock();
    }
  }

  /**
   * 获取用户的所有记忆（不含向量，用于列表展示）
   * @param userId 用户ID
   * @returns 记忆列表
   */
  list(userId: string): Omit<Memory, 'embedding'>[] {
    const userMemories = this.getUserMemories(userId);
    return userMemories.map(({ embedding, ...rest }) => rest);
  }

  /**
   * 获取记忆总数
   * @param userId 可选，指定用户
   */
  count(userId?: string): number {
    if (userId) {
      return this.getUserMemories(userId).length;
    }
    // 统计所有用户的记忆总数
    let total = 0;
    for (const memories of this.cache.values()) {
      total += memories.length;
    }
    return total;
  }

  /**
   * 根据ID获取记忆（需验证用户归属）
   * @param userId 用户ID
   * @param id 记忆ID
   * @returns 记忆或 undefined
   */
  get(userId: string, id: string): Memory | undefined {
    const userMemories = this.getUserMemories(userId);
    return userMemories.find(m => m.id === id);
  }

  /**
   * 获取所有用户ID列表
   */
  getUsers(): string[] {
    return Array.from(this.cache.keys());
  }
}

// 导出单例实例
export const memoryStore = new MemoryStore();
