import type { Memory, SearchResult } from './types.js';

/**
 * 计算两个向量的余弦相似度
 * @param a 向量 A
 * @param b 向量 B
 * @returns 相似度值 (0-1)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`向量维度不匹配: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * 搜索最相似的记忆
 * @param queryEmbedding 查询向量
 * @param memories 记忆列表
 * @param limit 返回数量限制
 * @returns 按相似度排序的搜索结果
 */
export function searchSimilar(
  queryEmbedding: number[],
  memories: Memory[],
  limit: number = 5
): SearchResult[] {
  if (memories.length === 0) {
    return [];
  }

  // 计算所有记忆的相似度
  const results: SearchResult[] = memories.map(memory => ({
    memory,
    score: cosineSimilarity(queryEmbedding, memory.embedding)
  }));

  // 按相似度降序排序并返回前 N 个
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 过滤低于阈值的搜索结果
 * @param results 搜索结果
 * @param threshold 相似度阈值
 * @returns 过滤后的结果
 */
export function filterByThreshold(
  results: SearchResult[],
  threshold: number = 0.5
): SearchResult[] {
  return results.filter(r => r.score >= threshold);
}
