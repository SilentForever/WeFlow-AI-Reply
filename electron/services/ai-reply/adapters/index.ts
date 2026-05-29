import { BaseAdapter } from './BaseAdapter'
import { OllamaAdapter } from './OllamaAdapter'
import { OpenAIAdapter } from './OpenAIAdapter'
import { CustomAPIAdapter } from './CustomAPIAdapter'
import type { ModelConfig, ModelType, TestResult } from '../../../../src/types/ai-reply'

export function createAdapter(config: ModelConfig): BaseAdapter {
  switch (config.type) {
    case 'ollama':
      return new OllamaAdapter(config)
    case 'openai':
    case 'claude':
    case 'gemini':
      return new OpenAIAdapter(config)
    case 'custom':
      return new CustomAPIAdapter(config)
    default:
      throw new Error(`Unsupported model type: ${config.type}`)
  }
}

export async function testModelConnection(config: ModelConfig): Promise<TestResult> {
  try {
    const adapter = createAdapter(config)
    return adapter.testConnection()
  } catch (error) {
    return {
      success: false,
      message: `创建适配器失败: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export { BaseAdapter, OllamaAdapter, OpenAIAdapter, CustomAPIAdapter }
