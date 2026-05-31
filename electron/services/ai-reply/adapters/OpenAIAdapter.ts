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
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let detail = text || response.statusText
      try {
        const errJson = JSON.parse(text)
        detail = errJson.error?.message || errJson.message || errJson.msg || text
      } catch {}
      if (response.status === 401) {
        throw new Error(`认证失败 (401): ${detail}。请检查 API Key 是否正确，以及是否与 API 地址匹配。`)
      }
      throw new Error(`API 请求失败 (${response.status}): ${detail}`)
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

      const baseUrl = cfg.baseUrl.replace(/\/$/, '')

      const testUrl = `${baseUrl}/chat/completions`
      const testBody = {
        model: cfg.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false
      }

      const response = await fetch(testUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify(testBody),
        signal: AbortSignal.timeout(15000)
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        let detail = text || response.statusText
        try {
          const errJson = JSON.parse(text)
          detail = errJson.error?.message || errJson.message || errJson.msg || text
        } catch {}
        return {
          success: false,
          message: `连接失败 (${response.status}): ${detail}`,
          latencyMs: Date.now() - startTime
        }
      }

      return {
        success: true,
        message: `连接成功，模型 "${cfg.model}" 可用`,
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
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(10000)
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
