import { create } from 'zustand'
import type { ServiceStatus, ModelConfig, Skill, TriggerRules, ReplyLog, DailyStats, ContactSkillMapping } from '../types/ai-reply'
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
  }
}))
