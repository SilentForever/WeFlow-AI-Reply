import type {
  MessageSender,
  SendTextRequest,
  SendTextResult,
  SenderHealth,
  WeClawHttpSenderConfig
} from './types'

interface WeClawSendPayload {
  to: string
  text: string
  type: 'text'
  isGroup?: boolean
}

export class WeClawHttpSender implements MessageSender {
  id = 'weclaw-http' as const
  displayName = 'WeClaw HTTP'
  riskLevel = 'medium' as const

  constructor(private config: WeClawHttpSenderConfig) {}

  updateConfig(config: WeClawHttpSenderConfig): void {
    this.config = { ...config }
  }

  async getHealth(): Promise<SenderHealth> {
    if (!this.config.enabled) {
      return {
        available: false,
        reason: 'WeClaw HTTP sender is disabled.',
        capabilities: this.capabilities()
      }
    }

    if (!this.config.baseUrl) {
      return {
        available: false,
        reason: 'WeClaw base URL is empty.',
        capabilities: this.capabilities()
      }
    }

    try {
      const response = await this.request('/health', { method: 'GET' })
      return {
        available: response.ok,
        reason: response.ok ? undefined : `Health check returned HTTP ${response.status}`,
        capabilities: this.capabilities()
      }
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        capabilities: this.capabilities()
      }
    }
  }

  async sendText(request: SendTextRequest): Promise<SendTextResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        delivered: false,
        senderId: this.id,
        error: 'WeClaw HTTP sender is disabled.'
      }
    }

    const target = this.resolveTarget(request)
    if (!target) {
      return {
        success: false,
        delivered: false,
        senderId: this.id,
        error: 'Unable to resolve WeClaw recipient. Configure contact mapping before sending.'
      }
    }

    const payload: WeClawSendPayload = {
      to: target,
      text: request.text,
      type: 'text',
      isGroup: Boolean(request.isGroup)
    }

    try {
      const response = await this.request('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const bodyText = await response.text().catch(() => '')

      if (!response.ok) {
        return {
          success: false,
          delivered: false,
          senderId: this.id,
          error: `WeClaw send failed with HTTP ${response.status}`,
          detail: bodyText
        }
      }

      return {
        success: true,
        delivered: true,
        senderId: this.id,
        detail: bodyText || 'Sent through WeClaw HTTP.',
        steps: [{ name: 'weclaw-http', status: 'ok', detail: `POST /api/send -> ${response.status}` }]
      }
    } catch (error) {
      return {
        success: false,
        delivered: false,
        senderId: this.id,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private resolveTarget(request: SendTextRequest): string {
    // WeClaw may use a sender-specific id. Until contact mapping UI is added,
    // prefer WeFlow contactId and fall back to display name for manual setups.
    return (request.contactId || request.contactName || '').trim()
  }

  private capabilities(): SenderHealth['capabilities'] {
    return {
      text: true,
      image: false,
      file: false,
      groupMention: false,
      silent: true
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 10000)

    try {
      const headers = new Headers(init.headers || {})
      if (this.config.token) {
        headers.set('Authorization', `Bearer ${this.config.token}`)
      }

      return await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
