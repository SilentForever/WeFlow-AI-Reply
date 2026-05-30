import { EventEmitter } from 'events'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { Skill, ChatRecord, DistillConfig, DistillProgress } from '../../../../src/types/ai-reply'
import { DEFAULT_REPLY_STRATEGY } from '../../../../src/types/ai-reply'
import { DISTILL_PROMPTS } from './prompts'
import { preprocessChatRecords, type PreprocessedRecords } from './preprocessor'
import type { BaseAdapter } from '../adapters'

export class DistillService extends EventEmitter {
  private tasks: Map<string, DistillProgress> = new Map()
  private results: Map<string, Skill> = new Map()
  private adapters: Map<string, BaseAdapter> = new Map()
  private activeAdapter: BaseAdapter | null = null
  private weflowBaseUrl: string = ''
  private weflowAccessToken: string = ''

  setAdapter(adapter: BaseAdapter): void {
    this.activeAdapter = adapter
  }

  setWeFlowConfig(baseUrl: string, accessToken: string): void {
    this.weflowBaseUrl = baseUrl
    this.weflowAccessToken = accessToken
  }

  async distillFromChatRecords(
    contactId: string,
    config: DistillConfig,
    adapter: BaseAdapter
  ): Promise<string> {
    const taskId = `distill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const totalRounds = 6

    const progress: DistillProgress = {
      taskId,
      status: 'preparing',
      currentRound: 0,
      totalRounds,
      roundResults: [
        { round: 1, name: 'expressionDNA', status: 'pending' },
        { round: 2, name: 'mentalModels', status: 'pending' },
        { round: 3, name: 'decisionHeuristics', status: 'pending' },
        { round: 4, name: 'valuesAndAntiPatterns', status: 'pending' },
        { round: 5, name: 'honestyBoundaries', status: 'pending' },
        { round: 6, name: 'validation', status: 'pending' }
      ],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    }

    this.tasks.set(taskId, progress)
    this.emit('progress', progress)

    try {
      const rawRecords = await this.fetchChatRecords(contactId, config.messageLimit || 5000)
      const preprocessed = this.preprocessMessages(rawRecords)

      progress.status = 'distilling'
      this.emit('progress', progress)

      const chatText = this.formatChatForPrompt(preprocessed)
      const roundResults: Record<string, any> = {}

      const rounds: Array<{ key: string; name: string; fn: (chatText: string, adapter: BaseAdapter, prevResults: Record<string, any>) => Promise<any> }> = [
        { key: 'expressionDNA', name: 'expressionDNA', fn: (c, a, p) => this.extractExpressionDNA(c, a) },
        { key: 'mentalModels', name: 'mentalModels', fn: (c, a, p) => this.extractMentalModels(c, a) },
        { key: 'decisionHeuristics', name: 'decisionHeuristics', fn: (c, a, p) => this.extractDecisionHeuristics(c, a) },
        { key: 'valuesAndAntiPatterns', name: 'valuesAndAntiPatterns', fn: (c, a, p) => this.extractValuesAndAntiPatterns(c, a) },
        { key: 'honestyBoundaries', name: 'honestyBoundaries', fn: (c, a, p) => this.extractHonestyBoundaries(c, a) },
        { key: 'validation', name: 'validation', fn: (c, a, p) => this.validateSkill(c, a, p) }
      ]

      for (let i = 0; i < rounds.length; i++) {
        const currentStatus: string = progress.status
        if (currentStatus === 'cancelled') break

        const round = rounds[i]
        const roundStart = Date.now()
        progress.currentRound = i + 1
        progress.roundResults[i].status = 'running'
        this.emit('progress', progress)

        try {
          const result = await round.fn(chatText, adapter, roundResults)
          roundResults[round.key] = result
          progress.roundResults[i].status = 'completed'
          progress.roundResults[i].durationMs = Date.now() - roundStart
        } catch (e) {
          progress.roundResults[i].status = 'error'
          progress.roundResults[i].durationMs = Date.now() - roundStart
          roundResults[round.key] = null
        }

        this.emit('progress', progress)
      }

      const finalStatus: string = progress.status
      if (finalStatus !== 'cancelled') {
        progress.status = 'validating'
        this.emit('progress', progress)

        const skill = this.generateSkillFiles(roundResults, config)
        this.results.set(taskId, skill)

        progress.status = 'completed'
        this.emit('progress', progress)
      }
    } catch (error) {
      progress.status = 'error'
      progress.error = error instanceof Error ? error.message : String(error)
      this.emit('progress', progress)
    }

    return taskId
  }

  async fetchChatRecords(contactId: string, limit: number, startDate?: string, endDate?: string): Promise<ChatRecord[]> {
    const params = new URLSearchParams({ talker: contactId, limit: String(limit) })
    if (startDate) params.set('start', startDate)
    if (endDate) params.set('end', endDate)

    const url = `${this.weflowBaseUrl}/api/v1/messages?${params.toString()}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.weflowAccessToken}` }
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch chat records: HTTP ${res.status}`)
    }

    const data: any = await res.json()
    return (data.messages || data.records || data.data || []).map((r: any) => ({
      id: String(r.localId || r.serverId || r.id || r.msgId || ''),
      content: String(r.parsedContent || r.content || r.text || ''),
      isSend: Boolean(r.isSend ?? r.is_send ?? r.isMe ?? false),
      timestamp: Number(r.createTime || r.timestamp || 0),
      type: Number(r.localType ?? r.type ?? 1)
    }))
  }

  preprocessMessages(records: ChatRecord[]): PreprocessedRecords {
    return preprocessChatRecords(records)
  }

  private async extractExpressionDNA(chatText: string, adapter: BaseAdapter): Promise<any> {
    const prompt = DISTILL_PROMPTS.expressionDNA.replace('{chatRecords}', chatText)
    return this.runDistillRound(adapter, prompt)
  }

  private async extractMentalModels(chatText: string, adapter: BaseAdapter): Promise<any> {
    const prompt = DISTILL_PROMPTS.mentalModels.replace('{chatRecords}', chatText)
    return this.runDistillRound(adapter, prompt)
  }

  private async extractDecisionHeuristics(chatText: string, adapter: BaseAdapter): Promise<any> {
    const prompt = DISTILL_PROMPTS.decisionHeuristics.replace('{chatRecords}', chatText)
    return this.runDistillRound(adapter, prompt)
  }

  private async extractValuesAndAntiPatterns(chatText: string, adapter: BaseAdapter): Promise<any> {
    const prompt = DISTILL_PROMPTS.valuesAndAntiPatterns.replace('{chatRecords}', chatText)
    return this.runDistillRound(adapter, prompt)
  }

  private async extractHonestyBoundaries(chatText: string, adapter: BaseAdapter): Promise<any> {
    const prompt = DISTILL_PROMPTS.honestyBoundaries.replace('{chatRecords}', chatText)
    return this.runDistillRound(adapter, prompt)
  }

  private async validateSkill(chatText: string, adapter: BaseAdapter, prevResults: Record<string, any>): Promise<any> {
    const summary = JSON.stringify(prevResults, null, 2)
    const sample = chatText.slice(0, 3000)
    let prompt = DISTILL_PROMPTS.validation
    prompt = prompt.replace('{skillSummary}', summary)
    prompt = prompt.replace('{chatRecordsSample}', sample)
    return this.runDistillRound(adapter, prompt)
  }

  private async runDistillRound(adapter: BaseAdapter, prompt: string): Promise<any> {
    const messages = [
      { role: 'system' as const, content: '你是一个专业的聊天记录分析专家，请严格按照要求的JSON格式输出分析结果。' },
      { role: 'user' as const, content: prompt }
    ]

    const result = await adapter.generate(messages, { maxTokens: 4096 })

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch {}

    return { rawContent: result.content }
  }

  private formatChatForPrompt(preprocessed: PreprocessedRecords): string {
    const lines: string[] = []
    const allSorted = [...preprocessed.otherMessages, ...preprocessed.selfMessages]
      .sort((a, b) => a.timestamp - b.timestamp)

    for (const msg of allSorted) {
      const sender = msg.isSend ? '我方' : '对方'
      const time = new Date(msg.timestamp).toLocaleString('zh-CN')
      lines.push(`[${time}] ${sender}: ${msg.content}`)
    }

    return lines.join('\n')
  }

  generateSkillFiles(roundResults: Record<string, any>, config: DistillConfig): Skill {
    const expression = roundResults.expressionDNA || {}
    const mental = roundResults.mentalModels || {}
    const decision = roundResults.decisionHeuristics || {}
    const values = roundResults.valuesAndAntiPatterns || {}
    const honesty = roundResults.honestyBoundaries || {}

    const skillId = `distilled_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const skill: Skill = {
      id: skillId,
      name: config.skillName || '蒸馏角色',
      version: '1.0.0',
      description: config.skillDescription || '通过聊天记录蒸馏生成的角色',
      selfMemory: {
        background: mental.reasoningStyle || '基于聊天记录蒸馏的角色',
        experiences: (values.antiPatterns || []).concat(values.contradictions || []),
        values: values.coreValues || [],
        preferences: {
          decisionPattern: decision.tradeoffPattern || '',
          riskAssessment: decision.riskAssessment || ''
        },
        relationships: []
      },
      persona: {
        identity: {
          role: config.skillName || '蒸馏角色',
          tags: (expression.vocabulary || []).slice(0, 10)
        },
        speechStyle: {
          tone: expression.tone || '',
          vocabulary: (expression.vocabulary || []).slice(0, 20),
          sentencePatterns: (expression.sentencePatterns || []).slice(0, 10),
          emojiUsage: expression.emojiUsage || ''
        },
        emotionalPatterns: {
          triggers: {},
          copingMechanisms: (values.defenseMechanisms || []).slice(0, 10)
        },
        behavioralRules: [
          ...(decision.quickJudgment || []).slice(0, 5),
          ...(decision.avoidanceStrategies || []).slice(0, 5),
          ...(values.taboos || []).slice(0, 5)
        ]
      },
      systemPromptTemplate: this.buildSystemPromptTemplate(expression, mental, decision, values, honesty),
      replyStrategy: DEFAULT_REPLY_STRATEGY,
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    return skill
  }

  private buildSystemPromptTemplate(
    expression: any,
    mental: any,
    decision: any,
    values: any,
    honesty: any
  ): string {
    const parts: string[] = []

    if (expression.tone) {
      parts.push(`语气风格: ${expression.tone}`)
    }
    if (expression.emojiUsage) {
      parts.push(`表情使用: ${expression.emojiUsage}`)
    }
    if (mental.reasoningStyle) {
      parts.push(`思维方式: ${mental.reasoningStyle}`)
    }
    if (decision.tradeoffPattern) {
      parts.push(`决策模式: ${decision.tradeoffPattern}`)
    }
    if (honesty.openness) {
      parts.push(`坦诚程度: ${honesty.openness}`)
    }
    if (values.coreValues && values.coreValues.length > 0) {
      parts.push(`核心价值观: ${values.coreValues.join('、')}`)
    }
    if (values.taboos && values.taboos.length > 0) {
      parts.push(`禁忌话题: ${values.taboos.join('、')}`)
    }

    return parts.join('\n')
  }

  getProgress(taskId: string): DistillProgress | null {
    return this.tasks.get(taskId) || null
  }

  getResult(taskId: string): Skill | null {
    return this.results.get(taskId) || null
  }

  cancelTask(taskId: string): void {
    const progress = this.tasks.get(taskId)
    if (progress) {
      const s: string = progress.status
      if (s === 'preparing' || s === 'distilling') {
        progress.status = 'cancelled'
        this.emit('progress', progress)
      }
    }
  }

  async saveSkill(taskId: string, outputDir: string, override?: Partial<Skill>): Promise<Skill> {
    const skill = this.results.get(taskId)
    if (!skill) throw new Error(`No result found for task: ${taskId}`)

    const finalSkill = override ? { ...skill, ...override } : skill

    await mkdir(outputDir, { recursive: true })

    const skillMd = this.renderSkillMd(finalSkill)
    const selfMd = this.renderSelfMd(finalSkill)
    const personaMd = this.renderPersonaMd(finalSkill)

    await writeFile(join(outputDir, 'SKILL.md'), skillMd, 'utf-8')
    await writeFile(join(outputDir, 'self.md'), selfMd, 'utf-8')
    await writeFile(join(outputDir, 'persona.md'), personaMd, 'utf-8')

    return finalSkill
  }

  private renderSkillMd(skill: Skill): string {
    const lines: string[] = []
    lines.push('---')
    lines.push(`id: ${skill.id}`)
    lines.push(`name: ${skill.name}`)
    lines.push(`version: ${skill.version}`)
    if (skill.author) lines.push(`author: ${skill.author}`)
    lines.push(`description: ${skill.description}`)
    lines.push('---')
    lines.push('')
    lines.push(`# ${skill.name}`)
    lines.push('')
    lines.push(skill.description)
    return lines.join('\n')
  }

  private renderSelfMd(skill: Skill): string {
    const lines: string[] = []
    lines.push('# 自我记忆')
    lines.push('')
    lines.push('## 背景')
    lines.push(skill.selfMemory.background)
    lines.push('')
    lines.push('## 经历')
    for (const exp of skill.selfMemory.experiences) {
      lines.push(`- ${exp}`)
    }
    lines.push('')
    lines.push('## 价值观')
    for (const v of skill.selfMemory.values) {
      lines.push(`- ${v}`)
    }
    return lines.join('\n')
  }

  private renderPersonaMd(skill: Skill): string {
    const lines: string[] = []
    lines.push('# 角色设定')
    lines.push('')
    lines.push('## 身份')
    lines.push(skill.persona.identity.role)
    lines.push('')
    lines.push('## 性格标签')
    for (const tag of skill.persona.identity.tags) {
      lines.push(`- ${tag}`)
    }
    lines.push('')
    lines.push('## 语气')
    lines.push(skill.persona.speechStyle.tone)
    lines.push('')
    lines.push('## 常用词汇')
    for (const v of skill.persona.speechStyle.vocabulary) {
      lines.push(`- ${v}`)
    }
    lines.push('')
    lines.push('## 句式')
    for (const p of skill.persona.speechStyle.sentencePatterns) {
      lines.push(`- ${p}`)
    }
    lines.push('')
    lines.push('## 规则')
    for (const r of skill.persona.behavioralRules) {
      lines.push(`- ${r}`)
    }
    return lines.join('\n')
  }
}
