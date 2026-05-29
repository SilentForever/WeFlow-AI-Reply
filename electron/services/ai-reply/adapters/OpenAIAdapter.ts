import { BaseAdapter } from './BaseAdapter'
import type { ChatMessage, GenerateOptions, GenerateResult, TestResult, OpenAICompatibleConfig } from '../../../../src/types/ai-reply'

export class OpenAIAdapter extends BaseAdapter {
  private getConfig(): OpenAICompatibleConfig {
    return this.getOpenAIConfig()
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const cfg = this.getConfig()
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`

    const body = {
      model: cfg.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? cfg.temperature,
      max_tokens: options?.maxTokens ?? cfg.maxTokens,
      stream: false
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`OpenAI API error (${response.status}): ${text || response.statusText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    return {
      content,
      model: cfg.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      } : undefined
    }
  }

  async testConnection(): Promise<TestResult> {
    const cfg = this.getConfig()
    const startTime = Date.now()

    try {
      if (!cfg.apiKey) {
        return { success: false, message: 'API Key 未配置' }
      }

      const url = `${cfg.baseUrl.replace(/\/$/, '')}/models`
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` }
      })

      if (!response.ok) {
        return {
          success: false,
          message: `连接失败: HTTP ${response.status}`,
          latencyMs: Date.now() - startTime
        }
      }

      return {
        success: true,
        message: `连接成功，API 可用`,
        latencyMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        success: false,
        message: `连接失败: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startTime
      }
    }
  }

  validateConfig(): boolean {
    const cfg = this.getConfig()
    return !!cfg.apiKey && !!cfg.baseUrl && !!cfg.model
  }

  async fetchAvailableModels(): Promise<{ id: string; name: string; isLocal: boolean }[]> {
    const cfg = this.getConfig()
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` }
      })
      const data = await res.json()
      return (data.data || []).map((m: any) => ({
        id: m.id as string,
        name: m.id as string,
        isLocal: false
      }))
    } catch {
      return []
    }
  }
}
