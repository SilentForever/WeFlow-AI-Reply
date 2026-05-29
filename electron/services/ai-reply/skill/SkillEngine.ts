import { readFile, readdir, mkdir, cp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import type { Skill, SelfMemory, Persona, PersonaIdentity, SpeechStyle, EmotionalPatterns, ReplyStrategy } from '../../../../src/types/ai-reply'
import { DEFAULT_REPLY_STRATEGY } from '../../../../src/types/ai-reply'

export class SkillEngine {
  private skills: Map<string, Skill> = new Map()
  private skillsDir: string

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir
  }

  async loadAllSkills(): Promise<Skill[]> {
    this.skills.clear()

    this.addBuiltinSkills()

    if (existsSync(this.skillsDir)) {
      const entries = await readdir(this.skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const skill = await this.loadSkillFromDirectory(join(this.skillsDir, entry.name))
            if (skill && !this.skills.has(skill.id)) {
              this.skills.set(skill.id, skill)
            }
          } catch (e) {
            console.warn(`[SkillEngine] Failed to load skill from ${entry.name}:`, e)
          }
        }
      }
    }

    return Array.from(this.skills.values())
  }

  getSkill(id: string): Skill | undefined {
    return this.skills.get(id)
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values())
  }

  addSkill(skill: Skill): void {
    this.skills.set(skill.id, skill)
  }

  removeSkill(id: string): boolean {
    if (this.skills.has(id) && !this.skills.get(id)?.isBuiltin) {
      return this.skills.delete(id)
    }
    return false
  }

  generateSystemPrompt(skill: Skill, extraContext?: {
    recentMessages?: Array<{ role: string; content: string }>
    relevantMemories?: string[]
    relationship?: { relationType: string; notes?: string } | undefined
  }): string {
    const { persona, selfMemory } = skill
    const parts: string[] = []

    parts.push(`# 角色设定`)
    parts.push(`你是「${persona.identity.role}」，${selfMemory.background}`)
    parts.push('')

    parts.push(`## 身份信息`)
    if (persona.identity.age) parts.push(`- 年龄: ${persona.identity.age}`)
    if (persona.identity.occupation) parts.push(`- 职业: ${persona.identity.occupation}`)
    if (persona.identity.mbti) parts.push(`- MBTI: ${persona.identity.mbti}`)
    parts.push(`- 性格标签: ${persona.identity.tags.join(', ')}`)
    parts.push('')

    if (persona.speechStyle.tone || persona.speechStyle.vocabulary.length > 0) {
      parts.push(`## 说话风格`)
      if (persona.speechStyle.tone) parts.push(`语气: ${persona.speechStyle.tone}`)
      if (persona.speechStyle.vocabulary.length > 0) {
        parts.push(`常用词汇: ${persona.speechStyle.vocabulary.join(', ')}`)
      }
      if (persona.speechStyle.sentencePatterns.length > 0) {
        parts.push(`句式特点: ${persona.speechStyle.sentencePatterns.join(', ')}`)
      }
      if (persona.speechStyle.emojiUsage) {
        parts.push(`表情使用: ${persona.speechStyle.emojiUsage}`)
      }
      parts.push('')
    }

    if (selfMemory.values.length > 0) {
      parts.push(`## 核心价值观`)
      selfMemory.values.forEach(v => parts.push(`- ${v}`))
      parts.push('')
    }

    if (persona.behavioralRules.length > 0) {
      parts.push(`## 行为规则`)
      persona.behavioralRules.forEach(r => parts.push(`- ${r}`))
      parts.push('')
    }

    if (selfMemory.experiences.length > 0) {
      parts.push(`## 重要记忆`)
      selfMemory.experiences.forEach(e => parts.push(`- ${e}`))
      parts.push('')
    }

    if (extraContext?.relationship) {
      parts.push(`## 与对方的关系`)
      parts.push(`关系类型: ${extraContext.relationship.relationType}`)
      if (extraContext.relationship.notes) {
        parts.push(`备注: ${extraContext.relationship.notes}`)
      }
      parts.push('')
    }

    if (extraContext?.relevantMemories && extraContext.relevantMemories.length > 0) {
      parts.push(`## 相关记忆`)
      extraContext.relevantMemories.forEach(m => parts.push(`- ${m}`))
      parts.push('')
    }

    if (skill.systemPromptTemplate) {
      parts.push(skill.systemPromptTemplate)
      parts.push('')
    }

    parts.push('---')
    parts.push('注意：回复必须符合上述角色设定，用第一人称"我"来回应。')

    return parts.join('\n')
  }

  private addBuiltinSkills(): void {
    const defaultSkill: Skill = {
      id: 'default-assistant',
      name: '默认助手',
      version: '1.0.0',
      description: '通用 AI 助手，适用于大多数对话场景',
      selfMemory: {
        background: '你是一个友好的 AI 助手',
        experiences: [],
        values: ['乐于助人', '诚实', '尊重'],
        preferences: {},
        relationships: []
      },
      persona: {
        identity: {
          role: 'AI 助手',
          tags: ['友好', '专业', '简洁']
        },
        speechStyle: {
          tone: '友好、专业、简洁',
          vocabulary: [],
          sentencePatterns: [],
          emojiUsage: '适度使用'
        },
        emotionalPatterns: {
          triggers: {},
          copingMechanisms: []
        },
        behavioralRules: [
          '回复要简洁明了',
          '保持友好态度',
          '不确定时坦诚说明'
        ]
      },
      systemPromptTemplate: '',
      replyStrategy: DEFAULT_REPLY_STRATEGY,
      isBuiltin: true
    }

    this.skills.set(defaultSkill.id, defaultSkill)
  }

  private async loadSkillFromDirectory(dirPath: string): Promise<Skill | null> {
    const skillMdPath = join(dirPath, 'SKILL.md')
    const selfMdPath = join(dirPath, 'self.md')
    const personaMdPath = join(dirPath, 'persona.md')

    if (!existsSync(skillMdPath)) return null

    const [skillMdContent, selfMdContent, personaMdContent] = await Promise.all([
      readFile(skillMdPath, 'utf-8').catch(() => ''),
      readFile(selfMdPath, 'utf-8').catch(() => ''),
      readFile(personaMdPath, 'utf-8').catch(() => '')
    ])

    const metaData = this.parseSkillMd(skillMdContent)
    const selfData = this.parseSelfMd(selfMdContent)
    const personaData = this.parsePersonaMd(personaMdContent)

    return {
      id: metaData.id || dirPath.split('/').pop() || 'unknown',
      name: metaData.name || '未命名角色',
      version: metaData.version || '1.0.0',
      author: metaData.author,
      description: metaData.description || '',
      selfMemory: selfData,
      persona: personaData,
      systemPromptTemplate: metaData.systemPrompt || '',
      replyStrategy: DEFAULT_REPLY_STRATEGY,
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  private parseSkillMd(content: string): {
    id?: string
    name?: string
    version?: string
    author?: string
    description?: string
    systemPrompt?: string
  } {
    const result: Record<string, string> = {}

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1]
      for (const line of frontmatter.split('\n')) {
        const match = line.match(/^(\w+):\s*(.+)/)
        if (match) {
          result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
        }
      }
    }

    const nameMatch = content.match(/^#\s+(.+)$/m)
    if (nameMatch && !result.name) {
      result.name = nameMatch[1].trim()
    }

    return result
  }

  private parseSelfMd(content: string): SelfMemory {
    if (!content) {
      return { background: '', experiences: [], values: [], preferences: {}, relationships: [] }
    }

    const sections = this.splitSections(content)

    return {
      background: sections['背景'] || sections['background'] || '',
      experiences: this.parseListSection(sections['经历'] || sections['experiences'] || ''),
      values: this.parseListSection(sections['价值观'] || sections['values'] || ''),
      preferences: {},
      relationships: []
    }
  }

  private parsePersonaMd(content: string): Persona {
    if (!content) {
      return {
        identity: { role: '', tags: [] },
        speechStyle: { tone: '', vocabulary: [], sentencePatterns: [], emojiUsage: '' },
        emotionalPatterns: { triggers: {}, copingMechanisms: [] },
        behavioralRules: []
      }
    }

    const sections = this.splitSections(content)

    const identity: PersonaIdentity = {
      role: sections['身份'] || sections['identity'] || '',
      tags: this.parseListSection(sections['性格标签'] || sections['tags'] || '')
    }

    const speechStyle: SpeechStyle = {
      tone: sections['语气'] || sections['tone'] || '',
      vocabulary: this.parseListSection(sections['常用词汇'] || sections['vocabulary'] || ''),
      sentencePatterns: this.parseListSection(sections['句式'] || sections['patterns'] || ''),
      emojiUsage: sections['表情'] || sections['emoji'] || ''
    }

    const emotionalPatterns: EmotionalPatterns = {
      triggers: {},
      copingMechanisms: this.parseListSection(sections['应对'] || sections['coping'] || '')
    }

    const behavioralRules = this.parseListSection(sections['规则'] || sections['rules'] || '')

    return {
      identity,
      speechStyle,
      emotionalPatterns,
      behavioralRules
    }
  }

  private splitSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {}
    let currentHeader = ''
    let currentContent: string[] = []

    for (const line of content.split('\n')) {
      const headerMatch = line.match(/^##?\s+(.+)$/)
      if (headerMatch) {
        if (currentHeader) {
          sections[currentHeader] = currentContent.join('\n').trim()
        }
        currentHeader = headerMatch[1].trim()
        currentContent = []
      } else {
        currentContent.push(line)
      }
    }

    if (currentHeader) {
      sections[currentHeader] = currentContent.join('\n').trim()
    }

    return sections
  }

  private parseListSection(content: string): string[] {
    return content
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0)
  }

  async importSkillFromDirectory(sourceDir: string): Promise<Skill> {
    const skill = await this.loadSkillFromDirectory(sourceDir)
    if (!skill) {
      throw new Error(`No valid skill found in ${sourceDir}`)
    }

    const destDir = join(this.skillsDir, skill.id)
    await mkdir(destDir, { recursive: true })
    await cp(sourceDir, destDir, { recursive: true })

    skill.updatedAt = Date.now()
    this.skills.set(skill.id, skill)
    return skill
  }

  async importSkillFromZip(zipPath: string): Promise<Skill> {
    const tmpDir = join(this.skillsDir, `.tmp_import_${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    try {
      await new Promise<void>((resolve, reject) => {
        exec(`unzip -o "${zipPath}" -d "${tmpDir}"`, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })

      const entries = await readdir(tmpDir, { withFileTypes: true })
      const skillDir = entries.find(e => e.isDirectory())?.name

      if (!skillDir) {
        throw new Error('No directory found in zip file')
      }

      const sourceDir = join(tmpDir, skillDir)
      const skill = await this.importSkillFromDirectory(sourceDir)
      return skill
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  }

  async importSkillFromGit(repoUrl: string): Promise<Skill> {
    const tmpDir = join(this.skillsDir, `.tmp_git_${Date.now()}`)

    try {
      await new Promise<void>((resolve, reject) => {
        exec(`git clone --depth 1 "${repoUrl}" "${tmpDir}"`, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })

      const skill = await this.importSkillFromDirectory(tmpDir)
      return skill
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  }
}
