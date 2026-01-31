import { Ollama } from 'ollama';

/**
 * Ollama 客户端配置
 */
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-m3';

/**
 * Ollama 客户端实例
 */
const ollama = new Ollama({ host: OLLAMA_HOST });

/**
 * 生成文本的向量嵌入
 * @param text 要生成嵌入的文本
 * @returns 向量数组
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollama.embeddings({
      model: EMBEDDING_MODEL,
      prompt: text,
    });
    return response.embedding;
  } catch (error) {
    const err = error as Error;
    throw new Error(`Ollama embedding 生成失败: ${err.message}`);
  }
}

/**
 * 检查 Ollama 服务是否可用
 * @returns 是否可用
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前使用的模型名称
 */
export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

/**
 * 获取 Ollama 主机地址
 */
export function getOllamaHost(): string {
  return OLLAMA_HOST;
}
