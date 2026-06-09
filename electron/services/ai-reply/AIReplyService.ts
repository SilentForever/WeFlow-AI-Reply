import { EventEmitter } from 'events'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as http from 'http'
import * as https from 'https'
import type { WeChatMessage, Skill, ReplyLog, DailyStats, ContactSkillMapping, ModelType, ModelInfo, DistillConfig, DistillProgress, ChatRecord } from '../../../src/types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../../../src/types/ai-reply'
import { createAdapter, type BaseAdapter } from './adapters'
import { markdownToPlainText } from './utils/markdownToPlainText'
import { SkillEngine } from './skill/SkillEngine'
import { ContextManager } from './core/ContextManager'
import { TriggerEngine } from './core/TriggerEngine'
import { MessageDeduper } from './core/MessageDeduper'
import { DistillService, type ChatRecordFetcher } from './distill/DistillService'
import { SenderManager } from './senders/SenderManager'

export interface AIReplyServiceEvents {
  statusChanged: (status: string) => void
  sseStatusChanged: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  messageReceived: (message: WeChatMessage) => void
  replySent: (log: ReplyLog) => void
  replyError: (error: { contactId: string; error: string }) => void
  processingStarted: (info: { contactId: string; contactName: string; stage: string }) => void
  processingCompleted: (info: { contactId: string; contactName: string; success: boolean }) => void
  messageFlowUpdate: (info: { contactId: string; contactName: string; stage: string; detail?: string }) => void
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
  private maxReplyLogs: number = 5000
  private dailyStats: DailyStats = { receivedCount: 0, repliedCount: 0, activeContacts: 0, errorCount: 0 }
  private activeContactsToday: Set<string> = new Set()
  private sseConnection: EventSource | null = null
  private sseAbortController: AbortController | null = null
  private sseUrl: string = ''
  private accessToken: string = ''
  private selfWxid: string = ''
  private recentSentMessages: Map<string, number> = new Map()
  private sseStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected'
  private sseError: string = ''
  private distillService: DistillService
  private senderManager: SenderManager
  private autoReplyEnabled: boolean = true
  private logsFilePath: string
  private skillsDir: string
  private processingContacts: Set<string> = new Set()

  private messageBuffer: Map<string, { messages: WeChatMessage[], timer: NodeJS.Timeout, contactName: string, isGroup: boolean }> = new Map()
  private messageBufferDelay: number = 2000

  constructor(skillsDir: string) {
    super()
    this.skillsDir = skillsDir
    this.skillEngine = new SkillEngine(skillsDir)
    this.contextManager = new ContextManager()
    this.triggerEngine = new TriggerEngine(DEFAULT_TRIGGER_RULES)
    this.messageDeduper = new MessageDeduper()
    this.distillService = new DistillService()
    this.senderManager = new SenderManager()
    this.logsFilePath = join(skillsDir, '..', 'reply-logs.json')
    this.loadLogsFromDisk()

    this.distillService.on('progress', (progress: any) => {
      this.emit('distillProgress', progress)
    })
  }

  setDistillChatRecordFetcher(fetcher: ChatRecordFetcher): void {
    this.distillService.setChatRecordFetcher(fetcher)
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
      if (this.replyLogs.length > this.maxReplyLogs) {
        this.replyLogs = this.replyLogs.slice(-this.maxReplyLogs)
      }
      const dir = join(this.logsFilePath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.logsFilePath, JSON.stringify(this.replyLogs, null, 0), 'utf-8')
    } catch {}
  }

  async start(): Promise<void> {
    if (this.status === 'running') return

    if (this.modelAdapters.size === 0) {
      throw new Error('请先配置至少一个模型')
    }
    if (!this.activeModelId) {
      throw new Error('请选择一个激活模型')
    }

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
      this.modelAdapters.delete(modelConfig.id)
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
    return this.triggerEngine.getRules()
  }

  setAutoReplyEnabled(enabled: boolean): void {
    this.autoReplyEnabled = enabled
    this.senderManager.setAutoSendEnabled(enabled)
  }

  isAutoReplyEnabled(): boolean {
    return this.autoReplyEnabled
  }

  getSenderConfig(): any {
    return this.senderManager.getConfig()
  }

  setSenderConfig(config: any): any {
    return this.senderManager.updateConfig(config)
  }

  async getSenderHealth(senderId?: any): Promise<any> {
    return this.senderManager.getHealth(senderId)
  }

  setSSEConfig(url: string, accessToken: string): void {
    this.sseUrl = url
    this.accessToken = accessToken
  }

  setSelfNickname(name: string): void {
    this.triggerEngine.setSelfNickname(name)
  }

  setSelfWxid(wxid: string): void {
    this.selfWxid = wxid
  }

  getSSEStatus(): { status: string; error?: string } {
    return {
      status: this.sseStatus,
      error: this.sseError || undefined
    }
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

  setDailyStats(stats: DailyStats): void {
    this.dailyStats = {
      receivedCount: stats.receivedCount || 0,
      repliedCount: stats.repliedCount || 0,
      activeContacts: 0,
      errorCount: stats.errorCount || 0
    }
  }

  async testModelConnection(modelId: string): Promise<any> {
    const adapter = this.modelAdapters.get(modelId)
    if (!adapter) {
      return { success: false, message: '模型未找到' }
    }
    return adapter.testConnection()
  }

  async testModelWithConfig(modelConfig: any): Promise<any> {
    try {
      const adapter = createAdapter(modelConfig)
      if (!adapter) {
        return { success: false, message: `不支持的模型类型: ${modelConfig.type}` }
      }
      return await adapter.testConnection()
    } catch (error) {
      return { success: false, message: `测试失败: ${error instanceof Error ? error.message : String(error)}` }
    }
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
      const result = await adapter.generate(messages, {
        maxTokens: skill.replyStrategy.maxReplyLength
      })
      const latencyMs = Date.now() - start
      // 转换 Markdown 为纯文本格式
      const plainContent = markdownToPlainText(result.content)
      return { content: plainContent, latencyMs }
    } catch (error) {
      return { content: `生成失败: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private async handleIncomingMessage(message: WeChatMessage): Promise<void> {
    console.log(`[AIReplyService] >>> 收到新消息 <<< msgId=${message.msgId}, from=${message.contactName}(${message.contactId}), isGroup=${message.isGroup}`)
    console.log(`[AIReplyService] 当前服务状态: ${this.status}`)

    if (this.status !== 'running') {
      console.log(`[AIReplyService] 服务未运行，跳过处理`)
      return
    }

    if (this.messageDeduper.isDuplicate(message.msgId)) {
      console.log(`[AIReplyService] 消息去重，跳过: msgId=${message.msgId}`)
      return
    }
    this.messageDeduper.markProcessed(message.msgId, message.content)

    if (message.isSend) {
      console.log(`[AIReplyService] 是自己发送的消息，跳过`)
      return
    }
    if (message.type === 10000) {
      console.log(`[AIReplyService] 是系统消息(type=10000)，跳过`)
      return
    }

    console.log(`[AIReplyService] 消息内容: ${message.content.substring(0, 80)}${message.content.length > 80 ? '...' : ''}`)

    this.dailyStats.receivedCount++
    this.activeContactsToday.add(message.contactId)
    this.emit('messageReceived', message)
    this.emit('messageFlowUpdate', {
      contactId: message.contactId,
      contactName: message.contactName,
      stage: 'received',
      detail: message.content.slice(0, 50)
    })

    const existingEntry = this.messageBuffer.get(message.contactId)
    if (existingEntry) {
      clearTimeout(existingEntry.timer)
      existingEntry.messages.push(message)
      console.log(`[AIReplyService] 消息缓冲: ${message.contactId} 有 ${existingEntry.messages.length} 条消息等待合并，${this.messageBufferDelay}ms 后处理`)
      this.emit('messageFlowUpdate', {
        contactId: message.contactId,
        contactName: message.contactName,
        stage: 'buffering',
        detail: `已缓冲 ${existingEntry.messages.length} 条消息`
      })
    } else {
      console.log(`[AIReplyService] 开始缓冲消息: ${message.contactId}, ${this.messageBufferDelay}ms 后处理`)
      this.emit('messageFlowUpdate', {
        contactId: message.contactId,
        contactName: message.contactName,
        stage: 'buffering',
        detail: '等待合并更多消息...'
      })
      const timer = setTimeout(() => {
        console.log(`[AIReplyService] >>> 缓冲超时，开始处理消息 <<< contactId=${message.contactId}`)
        this.processBufferedMessages(message.contactId)
      }, this.messageBufferDelay)
      this.messageBuffer.set(message.contactId, {
        messages: [message],
        timer,
        contactName: message.contactName,
        isGroup: message.isGroup
      })
    }
  }

  private async processBufferedMessages(contactId: string): Promise<void> {
    console.log(`[AIReplyService] >>> processBufferedMessages 开始 <<< contactId=${contactId}`)
    const entry = this.messageBuffer.get(contactId)
    if (!entry) {
      console.log(`[AIReplyService] 缓冲条目不存在，可能已处理或超时清除`)
      return
    }

    this.messageBuffer.delete(contactId)

    if (this.processingContacts.has(contactId)) {
      console.log(`[AIReplyService] 该联系人正在处理中，跳过: ${entry.contactName}`)
      this.emit('messageFlowUpdate', { contactId, contactName: entry.contactName, stage: 'skipped', detail: '该联系人正在处理中，跳过重复消息' })
      return
    }
    this.processingContacts.add(contactId)
    console.log(`[AIReplyService] 开始处理消息: ${entry.contactName}, 消息数: ${entry.messages.length}`)

    try {
      this.emit('processingStarted', { contactId, contactName: entry.contactName, stage: 'trigger' })
      this.emit('messageFlowUpdate', { contactId, contactName: entry.contactName, stage: 'trigger', detail: '检查触发规则...' })

      const mergedContent = entry.messages.map(m => m.content).join('\n')
      const triggerMessage: WeChatMessage = {
        ...entry.messages[0],
        content: mergedContent
      }
      const triggerResult = this.triggerEngine.shouldReply(triggerMessage)
      console.log(`[AIReplyService] 触发规则检查: shouldReply=${triggerResult.shouldReply}, reason=${triggerResult.reason || 'none'}`)
      if (!triggerResult.shouldReply) {
        this.processingContacts.delete(contactId)
        console.log(`[AIReplyService] 不满足触发条件，跳过`)
        this.emit('messageFlowUpdate', { contactId, contactName: entry.contactName, stage: 'skipped', detail: triggerResult.reason || '不满足触发条件' })
        this.emit('processingCompleted', { contactId, contactName: entry.contactName, success: false })
        return
      }

      this.emit('processingStarted', { contactId, contactName: entry.contactName, stage: 'generating' })
      this.emit('messageFlowUpdate', { contactId, contactName: entry.contactName, stage: 'generating', detail: '正在生成回复...' })

      const skillId = this.contactSkillMappings.get(contactId) || this.activeSkillId
      const skill = this.skillEngine.getSkill(skillId)
      console.log(`[AIReplyService] 使用角色: ${skill?.name || '未找到'} (${skillId})`)
      if (!skill) {
        this.processingContacts.delete(contactId)
        console.log(`[AIReplyService] 未找到角色配置，停止`)
        this.emit('messageFlowUpdate', { contactId, contactName: entry.contactName, stage: 'error', detail: '未找到角色配置' })
        this.emit('processingCompleted', { contactId, contactName: entry.contactName, success: false })
        return
      }

      const adapter = this.modelAdapters.get(this.activeModelId)
      console.log(`[AIReplyService] 使用模型: ${adapter?.getModelInfo().name || '未配置'} (${this.activeModelId})`)
      if (!adapter) {
        console.log(`[AIReplyService] 未配置模型，停止`)
        this.emit('replyError', { contactId, error: '未配置模型' })
        this.processingContacts.delete(contactId)
        this.emit('messageFlowUpdate', { contactId, contactName: entry.contactName, stage: 'error', detail: '未配置模型' })
        this.emit('processingCompleted', { contactId, contactName: entry.contactName, success: false })
        return
      }

      const startTime = Date.now()
      const contactName = entry.contactName
      const isGroup = entry.isGroup
      console.log(`[AIReplyService] 合并后消息内容: ${mergedContent.substring(0, 100)}${mergedContent.length > 100 ? '...' : ''}`)

      try {
        const { messages: context, summary } = this.contextManager.getContextWithSummary(contactId)
        console.log(`[AIReplyService] 上下文消息数: ${context.length}, 摘要: ${summary || 'none'}`)

        const relationship = skill.selfMemory.relationships.find(
          r => r.contactId === contactId
        )
        if (relationship) {
          console.log(`[AIReplyService] 找到关系信息: ${relationship.relationship}`)
        }

        const systemPrompt = this.skillEngine.generateSystemPrompt(skill, {
          recentMessages: context.slice(-5),
          relationship,
          contextSummary: summary
        })

        const messages = [
          { role: 'system' as const, content: systemPrompt },
          ...context,
          { role: 'user' as const, content: mergedContent }
        ]
        console.log(`[AIReplyService] 开始调用 AI 模型生成回复...`)

        const result = await adapter.generate(messages, {
          maxTokens: skill.replyStrategy.maxReplyLength
        })

        const plainContent = markdownToPlainText(result.content)
        console.log(`[AIReplyService] AI 回复已生成: ${plainContent.substring(0, 80)}${plainContent.length > 80 ? '...' : ''}`)

        this.contextManager.addMessage(contactId, {
          role: 'user',
          content: mergedContent,
          timestamp: entry.messages[0].timestamp
        })
        this.contextManager.addMessage(contactId, {
          role: 'assistant',
          content: plainContent,
          timestamp: Date.now()
        })

        const latencyMs = Date.now() - startTime

        if (skill.replyStrategy.responseDelay.min > 0) {
          const delay = Math.random() *
            (skill.replyStrategy.responseDelay.max - skill.replyStrategy.responseDelay.min) +
            skill.replyStrategy.responseDelay.min
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        let sent = false
        let sendError: string | undefined

        console.log(`[AIReplyService] >>> 开始发送流程 <<<`)
        console.log(`[AIReplyService] 联系人: ${contactName} (${contactId}), 是否群聊: ${isGroup}`)
        console.log(`[AIReplyService] autoReplyEnabled: ${this.autoReplyEnabled}, autoSendEnabled: ${this.senderManager.isAutoSendEnabled()}`)

        if (this.autoReplyEnabled && this.senderManager.isAutoSendEnabled()) {
          console.log(`[AIReplyService] 开始调用 WeChatSender.sendTextMessage...`)
          console.log(`[AIReplyService] 消息内容: ${plainContent.substring(0, 100)}${plainContent.length > 100 ? '...' : ''}`)

          this.emit('processingStarted', { contactId, contactName, stage: 'sending' })
          this.emit('messageFlowUpdate', { contactId, contactName, stage: 'sending', detail: '正在发送到微信...' })
          try {
            const sendStartTime = Date.now()
            const sendResult = await this.senderManager.sendText({
              contactId,
              contactName,
              text: plainContent,
              isGroup
            })
            const sendDuration = Date.now() - sendStartTime

            console.log(`[AIReplyService] WeChatSender 返回: success=${sendResult.success}, error=${sendResult.error || 'none'}`)
            console.log(`[AIReplyService] 发送耗时: ${sendDuration}ms`)

            if (sendResult.success && sendResult.delivered) {
              sent = true
              const sentKey = `${contactId}:${plainContent}`
              this.recentSentMessages.set(sentKey, Date.now())
              console.log(`[AIReplyService] >>> 发送成功 <<<`)
            } else {
              sendError = `发送失败: ${sendResult.error || sendResult.detail || '投递结果未确认'}`
              this.dailyStats.errorCount++
              console.warn(`[AIReplyService] >>> 发送失败 <<<: ${sendResult.error}`)
              this.emit('replyError', { contactId: contactId, error: sendError })
            }
          } catch (sendErr: any) {
            sendError = `发送异常: ${sendErr.message}`
            this.dailyStats.errorCount++
            console.error(`[AIReplyService] >>> 发送抛出异常 <<<: ${sendErr.message}`, sendErr)
            this.emit('replyError', { contactId: contactId, error: sendError })
          }
        } else {
          console.log(`[AIReplyService] 跳过发送: autoReplyEnabled=${this.autoReplyEnabled}, autoSendEnabled=${this.senderManager.isAutoSendEnabled()}`)
        }

        const log: ReplyLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          contactId: contactId,
          contactName: contactName,
          receivedMessage: mergedContent,
          generatedReply: plainContent,
          skillId: skill.id,
          skillName: skill.name,
          modelId: this.activeModelId,
          modelName: adapter.getModelInfo().name,
          latencyMs,
          success: !sendError,
          sent,
          errorMessage: sendError
        }

        this.replyLogs.push(log)
        this.saveLogsToDisk()
        if (sent) {
          this.dailyStats.repliedCount++
        }
        this.emit('replySent', log)
        this.emit('processingCompleted', { contactId, contactName, success: !sendError })
        this.emit('messageFlowUpdate', {
          contactId,
          contactName,
          stage: sent ? 'sent' : 'generated',
          detail: sent ? '已发送到微信' : (sendError || '回复已生成（未发送）')
        })

      } catch (error) {
        const latencyMs = Date.now() - startTime
        const log: ReplyLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          contactId: contactId,
          contactName: contactName,
          receivedMessage: mergedContent,
          generatedReply: '',
          skillId: skill.id,
          skillName: skill.name,
          modelId: this.activeModelId,
          modelName: '',
          latencyMs,
          success: false,
          sent: false,
          errorMessage: error instanceof Error ? error.message : String(error)
        }

        this.replyLogs.push(log)
        this.saveLogsToDisk()
        this.dailyStats.errorCount++
        this.emit('replyError', { contactId: contactId, error: log.errorMessage || 'Unknown error' })
        this.emit('messageFlowUpdate', {
          contactId,
          contactName,
          stage: 'error',
          detail: log.errorMessage || '处理出错'
        })
        this.emit('processingCompleted', { contactId, contactName, success: false })
      }
    } finally {
      this.processingContacts.delete(contactId)
    }
  }

  private connectSSE(): void {
    this.disconnectSSE()

    if (!this.sseUrl) {
      console.warn('[AIReplyService] SSE URL not configured, skipping connection')
      this.sseStatus = 'error'
      this.sseError = 'SSE URL 未配置'
      this.emit('sseStatusChanged', this.sseStatus)
      return
    }

    this.sseStatus = 'connecting'
    this.sseError = ''
    this.emit('sseStatusChanged', this.sseStatus)

    try {
      const url = new URL(this.sseUrl)
      if (this.accessToken) {
        url.searchParams.set('access_token', this.accessToken)
      }

      this.sseAbortController = new AbortController()
      const { signal } = this.sseAbortController

      const isHttps = url.protocol === 'https:'
      const requestModule = isHttps ? https : http

      const options: (http.RequestOptions | https.RequestOptions) = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
        signal
      }

      const req = requestModule.request(options, (res) => {
        if (res.statusCode !== 200) {
          console.warn(`[AIReplyService] SSE connection returned status ${res.statusCode}`)
          this.sseStatus = 'error'
          this.sseError = `HTTP ${res.statusCode}`
          this.emit('sseStatusChanged', this.sseStatus)
          return
        }

        console.log(`[AIReplyService] SSE connected to ${url.toString()}`)
        this.sseStatus = 'connected'
        this.sseError = ''
        this.emit('sseStatusChanged', this.sseStatus)

        let buffer = ''
        let currentEvent = ''

        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => {
          if (signal.aborted) return
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.replace(/\r$/, '')

            if (trimmed === '') {
              currentEvent = ''
              continue
            }

            if (trimmed.startsWith(':')) {
              continue
            }

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.slice(6).trim()
              continue
            }

            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim()
              if (currentEvent === 'message.new' || currentEvent === '' || currentEvent === 'message') {
                this.handleSSEData(dataStr)
              }
              currentEvent = ''
              continue
            }

            if (!currentEvent && trimmed.startsWith('{')) {
              this.handleSSEData(trimmed)
            }
          }
        })

        res.on('end', () => {
          if (!signal.aborted && this.status === 'running') {
            console.warn('[AIReplyService] SSE connection ended, reconnecting in 3s...')
            this.sseStatus = 'connecting'
            this.emit('sseStatusChanged', this.sseStatus)
            setTimeout(() => {
              if (this.status === 'running') this.connectSSE()
            }, 3000)
          } else {
            this.sseStatus = 'disconnected'
            this.emit('sseStatusChanged', this.sseStatus)
          }
        })

        res.on('error', (err: Error) => {
          console.warn('[AIReplyService] SSE stream error:', err.message)
          this.sseStatus = 'error'
          this.sseError = err.message
          this.emit('sseStatusChanged', this.sseStatus)
        })
      })

      req.on('error', (err: Error) => {
        if (!signal.aborted) {
          console.warn(`[AIReplyService] SSE request error: ${err.message}, reconnecting in 5s...`)
          this.sseStatus = 'error'
          this.sseError = err.message
          this.emit('sseStatusChanged', this.sseStatus)
          setTimeout(() => {
            if (this.status === 'running') this.connectSSE()
          }, 5000)
        }
      })

      req.end()
    } catch (error) {
      console.error('[AIReplyService] Failed to connect SSE:', error)
      this.sseStatus = 'error'
      this.sseError = error instanceof Error ? error.message : String(error)
      this.emit('sseStatusChanged', this.sseStatus)
      setTimeout(() => {
        if (this.status === 'running') this.connectSSE()
      }, 5000)
    }
  }

  private handleSSEData(dataStr: string): void {
    try {
      const data = JSON.parse(dataStr)
      const isGroup = data.sessionType === 'group' || String(data.sessionId || '').includes('@chatroom')
      const sessionId = data.sessionId || data.username || data.contactId || data.talker || ''
      const content = data.content || data.text || ''
      const groupName = String(data.groupName || data.groupDisplayName || '').trim()
      const contactName = isGroup
        ? (groupName || data.contactName || data.talkerName || data.nickname || sessionId)
        : (data.sourceName || data.nickname || data.contactName || data.talkerName || sessionId)

      // 自回复循环防护：检查是否是发给自己的消息
      if (!isGroup && this.selfWxid && sessionId === this.selfWxid) {
        console.log('[AIReplyService] Skipping self-message (私聊发给自己的消息)')
        return
      }

      // 自回复循环防护：检查是否是最近自己发送的消息
      const sentKey = `${sessionId}:${content}`
      const sentTime = this.recentSentMessages.get(sentKey)
      if (sentTime && Date.now() - sentTime < 10000) {
        console.log('[AIReplyService] Skipping self-sent message (最近发送的消息)')
        return
      }

      // 清理过期的发送记录（保留 30 秒内的记录）
      const now = Date.now()
      for (const [key, timestamp] of this.recentSentMessages.entries()) {
        if (now - timestamp > 30000) {
          this.recentSentMessages.delete(key)
        }
      }

      const message: WeChatMessage = {
        msgId: data.rawid || data.msgId || data.id || `msg_${Date.now()}`,
        contactId: sessionId,
        contactName,
        groupName: isGroup ? groupName || contactName : undefined,
        content,
        isGroup,
        isSend: Boolean(data.isSend ?? data.is_send ?? data.isMe ?? false),
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

  private disconnectSSE(): void {
    if (this.sseAbortController) {
      this.sseAbortController.abort()
      this.sseAbortController = null
    }
    this.sseConnection = null
    if (this.sseStatus !== 'disconnected') {
      this.sseStatus = 'disconnected'
      this.emit('sseStatusChanged', this.sseStatus)
    }
  }

  async fetchAvailableModels(modelType: ModelType, baseUrl: string, apiKey?: string): Promise<ModelInfo[]> {
    const config: any = {
      id: `_fetch_${modelType}`,
      name: `_fetch_${modelType}`,
      type: modelType,
      enabled: true,
      config: modelType === 'ollama'
        ? { baseUrl: baseUrl.replace(/\/$/, ''), model: '', temperature: 0.7, maxTokens: 2048 }
        : modelType === 'custom'
          ? { url: baseUrl, method: 'POST', headers: {}, bodyTemplate: {}, responsePath: '' }
          : { apiKey: apiKey || '', baseUrl: baseUrl.replace(/\/$/, ''), model: '', temperature: 0.7, maxTokens: 2048 }
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
    } catch (e) {
      throw new Error(`获取模型列表失败: ${e instanceof Error ? e.message : String(e)}`)
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
    modelId?: string
  }): Promise<string> {
    const targetModelId = params.modelId || this.activeModelId
    const adapter = this.modelAdapters.get(targetModelId)
    if (!adapter) {
      throw new Error('未配置模型，请先添加模型')
    }

    if (this.sseUrl) {
      this.distillService.setWeFlowConfig(this.sseUrl.replace('/api/v1/push/messages', ''), this.accessToken)
    }

    return this.distillService.distillFromChatRecords(
      params.contactId,
      params.config,
      adapter
    )
  }

  startDistillAsync(params: {
    contactId: string
    config: DistillConfig
    modelId?: string
  }): string {
    const targetModelId = params.modelId || this.activeModelId
    const adapter = this.modelAdapters.get(targetModelId)
    if (!adapter) {
      throw new Error('未配置模型，请先添加模型')
    }

    if (this.sseUrl) {
      this.distillService.setWeFlowConfig(this.sseUrl.replace('/api/v1/push/messages', ''), this.accessToken)
    }

    const taskId = this.distillService.createTask(params.contactId, params.config)

    this.distillService.distillFromChatRecordsAsync(
      params.contactId,
      params.config,
      adapter,
      taskId
    ).catch((err) => {
      console.error('[AIReplyService] Distill async error:', err)
    })

    return taskId
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
