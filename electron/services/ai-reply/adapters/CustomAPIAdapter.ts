import { BaseAdapter } from './BaseAdapter'
import type { ChatMessage, GenerateOptions, GenerateResult, TestResult, CustomAPIConfig } from '../../../../src/types/ai-reply'

export class CustomAPIAdapter extends BaseAdapter {
  private getConfig(): CustomAPIConfig {
    return this.getCustomConfig()
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const cfg = this.getConfig()

    const body = this.buildRequestBody(cfg, messages, options)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...cfg.headers
    }

    const response = await fetch(cfg.url, {
      method: cfg.method || 'POST',
      headers,
      body: cfg.method === 'GET' ? undefined : JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Custom API error (${response.status}): ${text || response.statusText}`)
    }

    const data = await response.json()
    const content = this.extractResponse(data, cfg.responsePath)

    return {
      content: content || '',
      model: 'custom'
    }
  }

  async testConnection(): Promise<TestResult> {
    const cfg = this.getConfig()
    const startTime = Date.now()

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...cfg.headers
      }

      const response = await fetch(cfg.url, {
        method: cfg.method || 'POST',
        headers,
        body: cfg.method === 'GET' ? undefined : JSON.stringify({})
      })

      return {
        success: response.status < 500,
        message: response.status < 500 ? 'API 端点可达' : `服务器错误: HTTP ${response.status}`,
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
    return !!cfg.url
  }

  async fetchAvailableModels(): Promise<{ id: string; name: string; isLocal: boolean }[]> {
    return []
  }

  private buildRequestBody(
    cfg: CustomAPIConfig,
    messages: ChatMessage[],
    options?: GenerateOptions
  ): Record<string, unknown> {
    const body = { ...cfg.bodyTemplate }

    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string') {
        if (value === '${MESSAGES}') {
          body[key] = messages.map(m => ({ role: m.role, content: m.content }))
        } else if (value === '${TEMPERATURE}') {
          body[key] = options?.temperature ?? 0.7
        } else if (value === '${MAX_TOKENS}') {
          body[key] = options?.maxTokens ?? 2048
        }
      }
    }

    return body
  }

  private extractResponse(data: Record<string, unknown>, path: string): string {
    if (!path) {
      if (typeof data === 'string') return data
      if (data.content) return String(data.content)
      if (data.choices?.[0]?.message?.content) return String((data.choices as any[])[0].message.content)
      return JSON.stringify(data)
    }

    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let current: unknown = data

    for (const part of parts) {
      if (current === null || current === undefined) return ''
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part]
      } else {
        return ''
      }
    }

    return String(current ?? '')
  }
}
