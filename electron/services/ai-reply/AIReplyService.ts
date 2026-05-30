import { EventEmitter } from 'events'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { WeChatMessage, Skill, ReplyLog, DailyStats, ContactSkillMapping, ModelType, ModelInfo, DistillConfig, DistillProgress, ChatRecord } from '../../../src/types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../../../src/types/ai-reply'
import { createAdapter, type BaseAdapter } from './adapters'
import { SkillEngine } from './skill/SkillEngine'
import { ContextManager } from './core/ContextManager'
import { TriggerEngine } from './core/TriggerEngine'
import { MessageDeduper } from './core/MessageDeduper'
import { DistillService } from './distill/DistillService'

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
  private distillService: DistillService
  private logsFilePath: string

  constructor(skillsDir: string) {
    super()
    this.skillEngine = new SkillEngine(skillsDir)
    this.contextManager = new ContextManager()
    this.triggerEngine = new TriggerEngine(DEFAULT_TRIGGER_RULES)
    this.messageDeduper = new MessageDeduper()
    this.distillService = new DistillService()
    this.logsFilePath = join(skillsDir, '..', 'reply-logs.json')
    this.loadLogsFromDisk()
  }

  private loadLogsFromDisk(): void {
    try {
      if (existsSync(this.logsFilePath)) {
        const raw = readFileSync(this.logsFilePath, 'utf-8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          this.replyLogs = data
        }
      }
    } catch {
      this.replyLogs = []
    }
  }

  private saveLogsToDisk(): void {
    try {
      const dir = join(this.logsFilePath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.logsFilePath, JSON.stringify(this.replyLogs, null, 0), 'utf-8')
    } catch {}
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

  getReplyLogs(limit = 100, offset = 0): ReplyLog[] {
    const sorted = [...this.replyLogs].sort((a, b) => b.timestamp - a.timestamp)
    return sorted.slice(offset, offset + limit)
  }

  getReplyLogsCount(): number {
    return this.replyLogs.length
  }

  clearReplyLogs(): void {
    this.replyLogs = []
    this.saveLogsToDisk()
  }

  deleteReplyLogs(ids: string[]): void {
    const idSet = new Set(ids)
    this.replyLogs = this.replyLogs.filter(log => !idSet.has(log.id))
    this.saveLogsToDisk()
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

  async generateTestReply(skillId: string, modelId: string, testMessage: string): Promise<{ content: string; latencyMs?: number }> {
    const skill = this.skillEngine.getSkill(skillId) || this.skillEngine.getSkill('default-assistant')
    if (!skill) return { content: '未找到角色' }

    const targetModelId = modelId || this.activeModelId
    const adapter = this.modelAdapters.get(targetModelId)
    if (!adapter) return { content: '未配置模型' }

    const systemPrompt = this.skillEngine.generateSystemPrompt(skill)
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: testMessage }
    ]

    try {
      const start = Date.now()
      const result = await adapter.generate(messages)
      const latencyMs = Date.now() - start
      return { content: result.content, latencyMs }
    } catch (error) {
      return { content: `生成失败: ${error instanceof Error ? error.message : String(error)}` }
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
      this.saveLogsToDisk()
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
      this.saveLogsToDisk()
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
          const isGroup = data.sessionType === 'group' || String(data.sessionId || '').includes('@chatroom')
          const message: WeChatMessage = {
            msgId: data.rawid || data.msgId || data.id || `msg_${Date.now()}`,
            contactId: data.sessionId || data.username || data.contactId || data.talker || '',
            contactName: data.sourceName || data.nickname || data.contactName || data.talkerName || '',
            content: data.content || data.text || '',
            isGroup,
            senderId: data.senderUsername || data.senderId || data.actualSender || '',
            senderName: data.sourceName || data.senderName || data.actualSenderName || '',
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

  async fetchAvailableModels(modelType: ModelType, baseUrl: string, apiKey?: string): Promise<ModelInfo[]> {
    const config: any = {
      id: `_fetch_${modelType}`,
      name: `_fetch_${modelType}`,
      type: modelType,
      enabled: true,
      config: modelType === 'ollama'
        ? { baseUrl, model: '', temperature: 0.7, maxTokens: 2048 }
        : { apiKey: apiKey || '', baseUrl, model: '', temperature: 0.7, maxTokens: 2048 }
    }

    try {
      const adapter = createAdapter(config)
      const models = await adapter.fetchAvailableModels()
      return models.map(m => ({
        id: m.id,
        name: m.name,
        type: modelType,
        isLocal: m.isLocal
      }))
    } catch {
      return []
    }
  }

  async importSkillFromDirectory(sourceDir: string): Promise<Skill> {
    return this.skillEngine.importSkillFromDirectory(sourceDir)
  }

  async importSkillFromZip(zipPath: string): Promise<Skill> {
    return this.skillEngine.importSkillFromZip(zipPath)
  }

  async importSkillFromGit(repoUrl: string): Promise<Skill> {
    return this.skillEngine.importSkillFromGit(repoUrl)
  }

  async startDistill(params: {
    contactId: string
    config: DistillConfig
  }): Promise<string> {
    const adapter = this.modelAdapters.get(this.activeModelId)
    if (!adapter) {
      throw new Error('No active model adapter configured')
    }

    this.distillService.setWeFlowConfig(this.sseUrl.replace('/api/v1/push/messages', ''), this.accessToken)

    return this.distillService.distillFromChatRecords(
      params.contactId,
      params.config,
      adapter
    )
  }

  cancelDistill(taskId: string): void {
    this.distillService.cancelTask(taskId)
  }

  getDistillProgress(taskId: string): DistillProgress | null {
    return this.distillService.getProgress(taskId)
  }

  getDistillResult(taskId: string): Skill | null {
    return this.distillService.getResult(taskId)
  }

  async saveDistillSkill(taskId: string, override?: Partial<Skill>): Promise<Skill> {
    const skill = this.distillService.getResult(taskId)
    if (!skill) throw new Error(`No result found for task: ${taskId}`)

    const finalSkill = override ? { ...skill, ...override } : skill
    const outputDir = `${(this.skillEngine as any).skillsDir}/${finalSkill.id}`
    const saved = await this.distillService.saveSkill(taskId, outputDir, override)
    this.skillEngine.addSkill(saved)
    return saved
  }

  async fetchChatRecords(contactId: string, limit: number, startDate?: string, endDate?: string): Promise<ChatRecord[]> {
    return this.distillService.fetchChatRecords(contactId, limit, startDate, endDate)
  }

  getWeFlowAPIConfig(): { baseUrl: string; accessToken: string } {
    return {
      baseUrl: this.sseUrl.replace('/api/v1/push/messages', ''),
      accessToken: this.accessToken
    }
  }

  async searchContacts(keyword: string, limit: number = 20): Promise<any[]> {
    const { baseUrl, accessToken } = this.getWeFlowAPIConfig()
    const params = new URLSearchParams({ keyword, limit: String(limit) })
    const url = `${baseUrl}/api/v1/contacts?${params.toString()}`

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })
      if (!res.ok) return []
      const data: any = await res.json()
      return data.contacts || data.data || []
    } catch {
      return []
    }
  }
}
