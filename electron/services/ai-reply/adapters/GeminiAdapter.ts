import { BaseAdapter } from './BaseAdapter'
import type { ChatMessage, GenerateOptions, GenerateResult, TestResult, OpenAICompatibleConfig } from '../../../../src/types/ai-reply'

export class GeminiAdapter extends BaseAdapter {
  private getConfig(): OpenAICompatibleConfig {
    return this.getOpenAIConfig()
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const cfg = this.getConfig()
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`

    const rawContents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }]
      }))
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
    for (const msg of rawContents) {
      const last = contents[contents.length - 1]
      if (last && last.role === msg.role) {
        last.parts.push(...msg.parts)
      } else {
        contents.push({ ...msg })
      }
    }
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] })
    }
    if (contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: '(继续)' }] })
    }

    const systemInstruction = messages.find(m => m.role === 'system')

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? cfg.temperature,
        maxOutputTokens: options?.maxTokens ?? cfg.maxTokens
      }
    }
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Gemini API error (${response.status}): ${text || response.statusText}`)
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    return {
      content,
      model: cfg.model,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        completionTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0
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

      const url = `${cfg.baseUrl.replace(/\/$/, '')}/models?key=${cfg.apiKey}`
      const response = await fetch(url, { method: 'GET' })

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { success: false, message: 'API Key 无效', latencyMs: Date.now() - startTime }
      }

      if (response.ok) {
        return { success: true, message: '连接成功，Gemini API 可用', latencyMs: Date.now() - startTime }
      }

      return { success: false, message: `连接失败: HTTP ${response.status}`, latencyMs: Date.now() - startTime }
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
      const url = `${cfg.baseUrl.replace(/\/$/, '')}/models?key=${cfg.apiKey}`
      const res = await fetch(url)
      const data = await res.json()
      return (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => ({
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name.replace('models/', ''),
          isLocal: false
        }))
    } catch {
      return [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', isLocal: false },
        { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', isLocal: false },
        { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', isLocal: false }
      ]
    }
  }
}
