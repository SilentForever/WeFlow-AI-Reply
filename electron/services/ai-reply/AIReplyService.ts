import { EventEmitter } from 'events'
import type { WeChatMessage, Skill, ReplyLog, DailyStats, ContactSkillMapping } from '../../src/types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../../src/types/ai-reply'
import { createAdapter, type BaseAdapter } from '../adapters'
import { SkillEngine } from '../skill/SkillEngine'
import { ContextManager } from './ContextManager'
import { TriggerEngine } from './TriggerEngine'
import { MessageDeduper } from './MessageDeduper'

export interface AIReplyServiceEvents {
  statusChanged: (status: string) => void
  messageReceived: (message: WeChatMessage) => void
  replySent: (log: ReplyLog) => void
  replyError: (error: { contactId: string; error: string }) => void
}

export class AIReplyService extends EventEmitter {
  private status: 'stopped' | 'running' | 'paused' | 'error' = 'stopped'
  private modelAdapters: Map<string, BaseAdapter> = new Map()
  private activeModelId: string = ''
  private activeSkillId: string = 'default-assistant'
  private contactSkillMappings: Map<string, string> = new Map()
  private skillEngine: SkillEngine
  private contextManager: ContextManager
  private triggerEngine: TriggerEngine
  private messageDeduper: MessageDeduper
  private replyLogs: ReplyLog[] = []
  private dailyStats: DailyStats = { receivedCount: 0, repliedCount: 0, activeContacts: 0, errorCount: 0 }
  private activeContactsToday: Set<string> = new Set()
  private sseConnection: EventSource | null = null
  private sseUrl: string = 'http://127.0.0.1:5031/api/v1/push/messages'
  private accessToken: string = ''

  constructor(skillsDir: string) {
    super()
    this.skillEngine = new SkillEngine(skillsDir)
    this.contextManager = new ContextManager()
    this.triggerEngine = new TriggerEngine(DEFAULT_TRIGGER_RULES)
    this.messageDeduper = new MessageDeduper()
  }

  async start(): Promise<void> {
    if (this.status === 'running') return

    try {
      await this.skillEngine.loadAllSkills()
      this.connectSSE()
      this.status = 'running'
      this.emit('statusChanged', this.status)
    } catch (error) {
      this.status = 'error'
      this.emit('statusChanged', this.status)
      throw error
    }
  }

  pause(): void {
    if (this.status !== 'running') return
    this.status = 'paused'
    this.disconnectSSE()
    this.emit('statusChanged', this.status)
  }

  resume(): void {
    if (this.status !== 'paused') return
    this.connectSSE()
    this.status = 'running'
    this.emit('statusChanged', this.status)
  }

  stop(): void {
    this.disconnectSSE()
    this.status = 'stopped'
    this.emit('statusChanged', this.status)
  }

  getStatus(): string {
    return this.status
  }

  setModelAdapter(modelConfig: any): void {
    try {
      const adapter = createAdapter(modelConfig)
      this.modelAdapters.set(modelConfig.id, adapter)
      if (!this.activeModelId) {
        this.activeModelId = modelConfig.id
      }
    } catch (error) {
      console.error('[AIReplyService] Failed to create adapter:', error)
    }
  }

  removeModelAdapter(modelId: string): void {
    this.modelAdapters.delete(modelId)
    if (this.activeModelId === modelId) {
      const remaining = Array.from(this.modelAdapters.keys())
      this.activeModelId = remaining.length > 0 ? remaining[0] : ''
    }
  }

  setActiveModel(modelId: string): void {
    if (this.modelAdapters.has(modelId)) {
      this.activeModelId = modelId
    }
  }

  getActiveModelId(): string {
    return this.activeModelId
  }

  setActiveSkill(skillId: string): void {
    if (this.skillEngine.getSkill(skillId)) {
      this.activeSkillId = skillId
    }
  }

  getActiveSkillId(): string {
    return this.activeSkillId
  }

  setContactSkillMapping(contactId: string, skillId: string): void {
    this.contactSkillMappings.set(contactId, skillId)
  }

  removeContactSkillMapping(contactId: string): void {
    this.contactSkillMappings.delete(contactId)
  }

  getContactSkillMappings(): ContactSkillMapping[] {
    return Array.from(this.contactSkillMappings.entries()).map(([contactId, skillId]) => ({
      contactId,
      skillId,
      enabled: true
    }))
  }

  setTriggerRules(rules: any): void {
    this.triggerEngine.updateRules(rules)
  }

  getTriggerRules(): any {
    return this.triggerEngine
  }

  setSSEConfig(url: string, accessToken: string): void {
    this.sseUrl = url
    this.accessToken = accessToken
  }

  getSkillEngine(): SkillEngine {
    return this.skillEngine
  }

  getContextManager(): ContextManager {
    return this.contextManager
  }

  getReplyLogs(limit = 100): ReplyLog[] {
    return this.replyLogs.slice(-limit)
  }

  clearReplyLogs(): void {
    this.replyLogs = []
  }

  getDailyStats(): DailyStats {
    return {
      ...this.dailyStats,
      activeContacts: this.activeContactsToday.size
    }
  }

  async testModelConnection(modelId: string): Promise<any> {
    const adapter = this.modelAdapters.get(modelId)
    if (!adapter) {
      return { success: false, message: '模型未找到' }
    }
    return adapter.testConnection()
  }

  async generateTestReply(skillId: string, testMessage: string): Promise<string> {
    const skill = this.skillEngine.getSkill(skillId) || this.skillEngine.getSkill('default-assistant')
    if (!skill) return '未找到角色'

    const adapter = this.modelAdapters.get(this.activeModelId)
    if (!adapter) return '未配置模型'

    const systemPrompt = this.skillEngine.generateSystemPrompt(skill)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: testMessage }
    ]

    try {
      const result = await adapter.generate(messages)
      return result.content
    } catch (error) {
      return `生成失败: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async handleIncomingMessage(message: WeChatMessage): Promise<void> {
    if (this.status !== 'running') return

    if (this.messageDeduper.isDuplicate(message.msgId)) return
    this.messageDeduper.markProcessed(message.msgId, message.content)

    this.dailyStats.receivedCount++
    this.activeContactsToday.add(message.contactId)
    this.emit('messageReceived', message)

    const triggerResult = this.triggerEngine.shouldReply(message)
    if (!triggerResult.shouldReply) return

    const skillId = this.contactSkillMappings.get(message.contactId) || this.activeSkillId
    const skill = this.skillEngine.getSkill(skillId)
    if (!skill) return

    const adapter = this.modelAdapters.get(this.activeModelId)
    if (!adapter) {
      this.emit('replyError', { contactId: message.contactId, error: '未配置模型' })
      return
    }

    const startTime = Date.now()

    try {
      const context = this.contextManager.getHistory(message.contactId)
      const relationship = skill.selfMemory.relationships.find(
        r => r.contactId === message.contactId
      )

      const systemPrompt = this.skillEngine.generateSystemPrompt(skill, {
        recentMessages: context.slice(-5),
        relationship
      })

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...context,
        { role: 'user' as const, content: message.content }
      ]

      const result = await adapter.generate(messages)

      this.contextManager.addMessage(message.contactId, {
        role: 'user',
        content: message.content,
        timestamp: message.timestamp
      })
      this.contextManager.addMessage(message.contactId, {
        role: 'assistant',
        content: result.content,
        timestamp: Date.now()
      })

      const latencyMs = Date.now() - startTime
      const log: ReplyLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        contactId: message.contactId,
        contactName: message.contactName,
        receivedMessage: message.content,
        generatedReply: result.content,
        skillId: skill.id,
        skillName: skill.name,
        modelId: this.activeModelId,
        modelName: adapter.getModelInfo().name,
        latencyMs,
        success: true
      }

      this.replyLogs.push(log)
      this.dailyStats.repliedCount++
      this.emit('replySent', log)

      if (skill.replyStrategy.responseDelay.min > 0) {
        const delay = Math.random() *
          (skill.replyStrategy.responseDelay.max - skill.replyStrategy.responseDelay.min) +
          skill.replyStrategy.responseDelay.min
        await new Promise(resolve => setTimeout(resolve, delay))
      }

    } catch (error) {
      const latencyMs = Date.now() - startTime
      const log: ReplyLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        contactId: message.contactId,
        contactName: message.contactName,
        receivedMessage: message.content,
        generatedReply: '',
        skillId: skill.id,
        skillName: skill.name,
        modelId: this.activeModelId,
        modelName: '',
        latencyMs,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error)
      }

      this.replyLogs.push(log)
      this.dailyStats.errorCount++
      this.emit('replyError', { contactId: message.contactId, error: log.errorMessage || 'Unknown error' })
    }
  }

  private connectSSE(): void {
    this.disconnectSSE()

    try {
      const url = new URL(this.sseUrl)
      if (this.accessToken) {
        url.searchParams.set('access_token', this.accessToken)
      }

      this.sseConnection = new EventSource(url.toString())

      this.sseConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          const message: WeChatMessage = {
            msgId: data.msgId || data.id || `msg_${Date.now()}`,
            contactId: data.username || data.contactId || data.talker || '',
            contactName: data.nickname || data.contactName || data.talkerName || '',
            content: data.content || data.text || '',
            isGroup: data.isGroup || data.chatroom || false,
            senderId: data.senderId || data.actualSender || '',
            senderName: data.senderName || data.actualSenderName || '',
            timestamp: data.timestamp || data.createTime || Date.now(),
            type: data.type || 1
          }

          if (message.contactId && message.content) {
            this.handleIncomingMessage(message)
          }
        } catch (e) {
          console.warn('[AIReplyService] Failed to parse SSE message:', e)
        }
      }

      this.sseConnection.onerror = () => {
        console.warn('[AIReplyService] SSE connection error, will retry...')
      }
    } catch (error) {
      console.error('[AIReplyService] Failed to connect SSE:', error)
    }
  }

  private disconnectSSE(): void {
    if (this.sseConnection) {
      this.sseConnection.close()
      this.sseConnection = null
    }
  }
}
