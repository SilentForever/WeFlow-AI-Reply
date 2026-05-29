import { create } from 'zustand'
import type { ServiceStatus, ModelConfig, Skill, TriggerRules, ReplyLog, DailyStats, ContactSkillMapping, ModelInfo, DistillProgress, ModelType } from '../types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../types/ai-reply'

const api = () => window.electronAPI?.aiReply

export interface AIReplyState {
  status: ServiceStatus
  models: ModelConfig[]
  activeModelId: string
  skills: Skill[]
  activeSkillId: string
  triggerRules: TriggerRules
  replyLogs: ReplyLog[]
  dailyStats: DailyStats
  contactSkillMappings: ContactSkillMapping[]
  testResult: { success: boolean; message: string; latencyMs?: number } | null
  testReplyResult: string | null
  isLoading: boolean
  error: string | null
  availableModels: ModelInfo[]
  fetchModelsLoading: boolean
  distillProgress: DistillProgress | null
  distillResult: Skill | null
  logFilter: { status: string; contactId: string; keyword: string }
  editingSkill: Skill | null
  selectedLogDetail: ReplyLog | null

  start: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  fetchStatus: () => Promise<void>
  fetchModels: () => Promise<void>
  addModel: (config: ModelConfig) => Promise<void>
  removeModel: (modelId: string) => Promise<void>
  setActiveModel: (modelId: string) => Promise<void>
  testModel: (modelId: string) => Promise<void>
  fetchSkills: () => Promise<void>
  addSkill: (skill: Skill) => Promise<void>
  removeSkill: (skillId: string) => Promise<void>
  setActiveSkill: (skillId: string) => Promise<void>
  reloadSkills: () => Promise<void>
  generateTestReply: (skillId: string, testMessage: string) => Promise<void>
  setTriggerRules: (rules: TriggerRules) => Promise<void>
  fetchTriggerRules: () => Promise<void>
  setContactSkillMapping: (contactId: string, skillId: string) => Promise<void>
  removeContactSkillMapping: (contactId: string) => Promise<void>
  fetchContactSkillMappings: () => Promise<void>
  fetchReplyLogs: (limit?: number) => Promise<void>
  clearReplyLogs: () => Promise<void>
  fetchDailyStats: () => Promise<void>
  clearContext: (contactId: string) => Promise<void>
  setupListeners: () => () => void
  fetchAvailableModels: (type: ModelType, baseUrl: string, apiKey?: string) => Promise<void>
  importSkillFromDirectory: (dir: string) => Promise<Skill | null>
  importSkillFromZip: (path: string) => Promise<Skill | null>
  importSkillFromGit: (url: string) => Promise<Skill | null>
  startDistill: (params: any) => Promise<string>
  cancelDistill: (taskId: string) => Promise<void>
  getDistillProgress: (taskId: string) => Promise<DistillProgress | null>
  saveDistillSkill: (taskId: string, override?: any) => Promise<Skill | null>
  searchContacts: (keyword: string) => Promise<any[]>
  setLogFilter: (filter: Partial<{ status: string; contactId: string; keyword: string }>) => void
  setEditingSkill: (skill: Skill | null) => void
  setSelectedLogDetail: (log: ReplyLog | null) => void
}

export const useAIReplyStore = create<AIReplyState>((set, get) => ({
  status: 'stopped',
  models: [],
  activeModelId: '',
  skills: [],
  activeSkillId: 'default-assistant',
  triggerRules: DEFAULT_TRIGGER_RULES,
  replyLogs: [],
  dailyStats: { receivedCount: 0, repliedCount: 0, activeContacts: 0, errorCount: 0 },
  contactSkillMappings: [],
  testResult: null,
  testReplyResult: null,
  isLoading: false,
  error: null,
  availableModels: [],
  fetchModelsLoading: false,
  distillProgress: null,
  distillResult: null,
  logFilter: { status: '', contactId: '', keyword: '' },
  editingSkill: null,
  selectedLogDetail: null,

  start: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await api()?.start()
      if (!result?.success) throw new Error(result?.error || '启动失败')
      set({ status: 'running', isLoading: false })
    } catch (e: any) {
      set({ error: e.message, isLoading: false })
    }
  },

  pause: async () => {
    await api()?.pause()
    set({ status: 'paused' })
  },

  resume: async () => {
    await api()?.resume()
    set({ status: 'running' })
  },

  stop: async () => {
    await api()?.stop()
    set({ status: 'stopped' })
  },

  fetchStatus: async () => {
    const status = await api()?.getStatus()
    if (status) set({ status: status as ServiceStatus })
  },

  fetchModels: async () => {
    const models = (await api()?.getModels() || []) as ModelConfig[]
    set({ models })
  },

  addModel: async (config) => {
    await api()?.addModel(config)
    await get().fetchModels()
  },

  removeModel: async (modelId) => {
    await api()?.removeModel(modelId)
    await get().fetchModels()
  },

  setActiveModel: async (modelId) => {
    await api()?.setActiveModel(modelId)
    set({ activeModelId: modelId })
  },

  testModel: async (modelId) => {
    set({ testResult: null })
    const result = await api()?.testModel(modelId)
    set({ testResult: result || null })
  },

  fetchSkills: async () => {
    const skills = (await api()?.getSkills() || []) as Skill[]
    set({ skills })
  },

  addSkill: async (skill) => {
    await api()?.addSkill(skill)
    await get().fetchSkills()
  },

  removeSkill: async (skillId) => {
    await api()?.removeSkill(skillId)
    await get().fetchSkills()
  },

  setActiveSkill: async (skillId) => {
    await api()?.setActiveSkill(skillId)
    set({ activeSkillId: skillId })
  },

  reloadSkills: async () => {
    const skills = (await api()?.reloadSkills() || []) as Skill[]
    set({ skills })
  },

  generateTestReply: async (skillId, testMessage) => {
    set({ testReplyResult: null, isLoading: true })
    const result = await api()?.generateTestReply(skillId, testMessage)
    set({ testReplyResult: result || '', isLoading: false })
  },

  setTriggerRules: async (rules) => {
    await api()?.setTriggerRules(rules)
    set({ triggerRules: rules })
  },

  fetchTriggerRules: async () => {
    const rules = await api()?.getTriggerRules()
    if (rules && Object.keys(rules).length > 0) set({ triggerRules: rules as unknown as TriggerRules })
  },

  setContactSkillMapping: async (contactId, skillId) => {
    await api()?.setContactSkillMapping(contactId, skillId)
    await get().fetchContactSkillMappings()
  },

  removeContactSkillMapping: async (contactId) => {
    await api()?.removeContactSkillMapping(contactId)
    await get().fetchContactSkillMappings()
  },

  fetchContactSkillMappings: async () => {
    const mappings = (await api()?.getContactSkillMappings() || []) as ContactSkillMapping[]
    set({ contactSkillMappings: mappings })
  },

  fetchReplyLogs: async (limit) => {
    const logs = (await api()?.getReplyLogs(limit) || []) as ReplyLog[]
    set({ replyLogs: logs })
  },

  clearReplyLogs: async () => {
    await api()?.clearReplyLogs()
    set({ replyLogs: [] })
  },

  fetchDailyStats: async () => {
    const stats = await api()?.getDailyStats()
    if (stats) set({ dailyStats: stats as DailyStats })
  },

  clearContext: async (contactId) => {
    await api()?.clearContext(contactId)
  },

  setupListeners: () => {
    const unsub1 = api()?.onStatusChanged((status) => {
      set({ status: status as ServiceStatus })
    }) || (() => {})

    const unsub2 = api()?.onReplySent((log) => {
      set((state) => ({
        replyLogs: [...state.replyLogs.slice(-99), log as ReplyLog]
      }))
    }) || (() => {})

    const unsub3 = api()?.onReplyError(() => {
      get().fetchDailyStats()
    }) || (() => {})

    return () => {
      unsub1()
      unsub2()
      unsub3()
    }
  },

  fetchAvailableModels: async (type, baseUrl, apiKey) => {
    set({ fetchModelsLoading: true })
    try {
      const models = await api()?.fetchAvailableModels(type, baseUrl, apiKey) || []
      set({ availableModels: models as ModelInfo[], fetchModelsLoading: false })
    } catch {
      set({ availableModels: [], fetchModelsLoading: false })
    }
  },

  importSkillFromDirectory: async (dir) => {
    try {
      const skill = await api()?.importSkillFromDirectory(dir)
      if (skill) {
        await get().fetchSkills()
        return skill as Skill
      }
    } catch {}
    return null
  },

  importSkillFromZip: async (path) => {
    try {
      const skill = await api()?.importSkillFromZip(path)
      if (skill) {
        await get().fetchSkills()
        return skill as Skill
      }
    } catch {}
    return null
  },

  importSkillFromGit: async (url) => {
    try {
      const skill = await api()?.importSkillFromGit(url)
      if (skill) {
        await get().fetchSkills()
        return skill as Skill
      }
    } catch {}
    return null
  },

  startDistill: async (params) => {
    const taskId = await api()?.startDistill(params) || ''
    return taskId
  },

  cancelDistill: async (taskId) => {
    await api()?.cancelDistill(taskId)
  },

  getDistillProgress: async (taskId) => {
    try {
      const progress = await api()?.getDistillProgress(taskId)
      if (progress) {
        set({ distillProgress: progress as DistillProgress })
        return progress as DistillProgress
      }
    } catch {}
    return null
  },

  saveDistillSkill: async (taskId, override) => {
    try {
      const skill = await api()?.saveDistillSkill(taskId, override)
      if (skill) {
        await get().fetchSkills()
        set({ distillResult: skill as Skill })
        return skill as Skill
      }
    } catch {}
    return null
  },

  searchContacts: async (keyword) => {
    try {
      const contacts = await api()?.searchContacts(keyword) || []
      return contacts
    } catch {
      return []
    }
  },

  setLogFilter: (filter) => {
    set((state) => ({
      logFilter: { ...state.logFilter, ...filter }
    }))
  },

  setEditingSkill: (skill) => {
    set({ editingSkill: skill })
  },

  setSelectedLogDetail: (log) => {
    set({ selectedLogDetail: log })
  }
}))
