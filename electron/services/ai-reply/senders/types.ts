export type SenderId = 'manual' | 'ui-automation' | 'weclaw-http' | 'wechatferry'

export interface SendTextRequest {
  contactId: string
  contactName: string
  text: string
  isGroup?: boolean
  rawMessage?: unknown
  traceId?: string
}

export interface SendStep {
  name: string
  status: 'ok' | 'warning' | 'error'
  detail?: string
}

export interface SendTextResult {
  success: boolean
  delivered: boolean
  senderId: SenderId
  error?: string
  detail?: string
  steps?: SendStep[]
}

export interface SenderHealth {
  available: boolean
  reason?: string
  version?: string
  capabilities: {
    text: boolean
    image: boolean
    file: boolean
    groupMention: boolean
    silent: boolean
  }
}

export interface MessageSender {
  id: SenderId
  displayName: string
  riskLevel: 'low' | 'medium' | 'high'
  getHealth(): Promise<SenderHealth>
  sendText(request: SendTextRequest): Promise<SendTextResult>
}

export interface UIAutomationSenderConfig {
  restoreClipboard?: boolean
  sendHotkey?: 'enter' | 'ctrl-enter'
}

export interface WeClawHttpSenderConfig {
  enabled: boolean
  baseUrl: string
  token?: string
  timeoutMs: number
}

export interface WeChatFerrySenderConfig {
  enabled: boolean
  endpoint?: string
  warningAcceptedAt?: number
}

export interface AIReplySenderConfig {
  activeSenderId: SenderId
  fallbackSenderId?: SenderId
  manualConfirmBeforeSend: boolean
  uiAutomation: UIAutomationSenderConfig
  weclawHttp: WeClawHttpSenderConfig
  wechatferry: WeChatFerrySenderConfig
}

export const DEFAULT_SENDER_CONFIG: AIReplySenderConfig = {
  activeSenderId: 'ui-automation',
  fallbackSenderId: 'manual',
  manualConfirmBeforeSend: false,
  uiAutomation: {
    restoreClipboard: true,
    sendHotkey: 'enter'
  },
  weclawHttp: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:19888',
    timeoutMs: 10000
  },
  wechatferry: {
    enabled: false
  }
}
