import { create } from 'zustand'
import type { ServiceStatus, ModelConfig, Skill, TriggerRules, ReplyLog, DailyStats, ContactSkillMapping, ModelInfo, DistillProgress, ModelType } from '../types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../types/ai-reply'

const api = () => (window.electronAPI?.aiReply as any)

export interface AIReplyState {
  status: ServiceStatus
  models: ModelConfig[]
  activeModelId: string
  skills: Skill[]
  activeSkillId: string
  triggerRules: TriggerRules
  replyLogs: ReplyLog[]
  replyLogsTotal: number
  dailyStats: DailyStats
  contactSkillMappings: ContactSkillMapping[]
  testResult: { success: boolean; message: string; latencyMs?: number } | null
  testReplyResult: string | null
  testReplyLatencyMs: number | undefined
  isLoading: boolean
  error: string | null
  availableModels: ModelInfo[]
  fetchModelsLoading: boolean
  distillProgress: DistillProgress | null
  distillResult: Skill | null
  logFilter: { status: string; contactId: string; keyword: string }
  editingSkill: Skill | null
  selectedLogDetail: ReplyLog | null
  autoReplyEnabled: boolean
  sseStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  sseError: string
  prerequisiteChecks: { name: string; passed: boolean; message: string; configKey?: string }[] | null
  prerequisitesAllPassed: boolean | null
  processingContacts: { contactId: string; contactName: string; stage: string; startedAt: number }[]
  messageFlow: { contactId: string; contactName: string; stage: string; detail: string; timestamp: number }[]

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
  generateTestReply: (skillId: string, modelId: string, testMessage: string) => Promise<void>
  setTriggerRules: (rules: TriggerRules) => Promise<void>
  fetchTriggerRules: () => Promise<void>
  setContactSkillMapping: (contactId: string, skillId: string) => Promise<void>
  removeContactSkillMapping: (contactId: string) => Promise<void>
  fetchContactSkillMappings: () => Promise<void>
  fetchReplyLogs: (limit?: number, offset?: number) => Promise<void>
  fetchReplyLogsCount: () => Promise<void>
  clearReplyLogs: () => Promise<void>
  deleteReplyLogs: (ids: string[]) => Promise<void>
  fetchDailyStats: () => Promise<void>
  clearContext: (contactId: string) => Promise<void>
  setupListeners: () => () => void
  fetchAvailableModels: (type: ModelType, baseUrl: string, apiKey?: string) => Promise<void>
  importSkillFromDirectory: (dir: string) => Promise<Skill | null>
  importSkillFromZip: (path: string) => Promise<Skill | null>
  importSkillFromGit: (url: string) => Promise<Skill | null>
  startDistill: (params: any) => Promise<string | { error: string }>
  cancelDistill: (taskId: string) => Promise<void>
  getDistillProgress: (taskId: string) => Promise<DistillProgress | null>
  saveDistillSkill: (taskId: string, override?: any) => Promise<Skill | null>
  searchContacts: (keyword: string) => Promise<any[]>
  setLogFilter: (filter: Partial<{ status: string; contactId: string; keyword: string }>) => void
  setEditingSkill: (skill: Skill | null) => void
  setSelectedLogDetail: (log: ReplyLog | null) => void
  setAutoReplyEnabled: (enabled: boolean) => Promise<void>
  fetchAutoReplyEnabled: () => Promise<void>
  fetchSSEStatus: () => Promise<void>
  checkPrerequisites: () => Promise<void>
  clearTestReply: () => void
  clearError: () => void
  setError: (error: string) => void
}

export const useAIReplyStore = create<AIReplyState>((set, get) => ({
  status: 'stopped',
  models: [],
  activeModelId: '',
  skills: [],
  activeSkillId: 'default-assistant',
  triggerRules: DEFAULT_TRIGGER_RULES,
  replyLogs: [],
  replyLogsTotal: 0,
  dailyStats: { receivedCount: 0, repliedCount: 0, activeContacts: 0, errorCount: 0 },
  contactSkillMappings: [],
  testResult: null,
  testReplyResult: null,
  testReplyLatencyMs: undefined,
  isLoading: false,
  error: null,
  availableModels: [],
  fetchModelsLoading: false,
  distillProgress: null,
  distillResult: null,
  logFilter: { status: '', contactId: '', keyword: '' },
  editingSkill: null,
  selectedLogDetail: null,
  autoReplyEnabled: true,
  sseStatus: 'disconnected',
  sseError: '',
  prerequisiteChecks: null,
  prerequisitesAllPassed: null,
  processingContacts: [],
  messageFlow: [],

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
    const activeModelId = await api()?.getActiveModelId() || ''
    set({ models, activeModelId: activeModelId || get().activeModelId })
  },

  addModel: async (config) => {
    set({ isLoading: true, error: null })
    try {
      const result = await api()?.addModel(config)
      if (result && !result.success) {
        throw new Error(result.error || '添加模型失败')
      }
      await get().fetchModels()
    } catch (e: any) {
      set({ error: e.message || '添加模型失败', isLoading: false })
      throw e
    } finally {
      set({ isLoading: false })
    }
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

  generateTestReply: async (skillId, modelId, testMessage) => {
    set({ testReplyResult: null, testReplyLatencyMs: undefined, isLoading: true })
    const result = await api()?.generateTestReply(skillId, modelId, testMessage)
    set({ testReplyResult: (result as any)?.content || result as string || '', testReplyLatencyMs: (result as any)?.latencyMs, isLoading: false })
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

  fetchReplyLogs: async (limit, offset) => {
    const logs = (await api()?.getReplyLogs(limit, offset) || []) as ReplyLog[]
    set({ replyLogs: logs })
  },

  fetchReplyLogsCount: async () => {
    const total = await api()?.getReplyLogsCount() || 0
    set({ replyLogsTotal: total })
  },

  clearReplyLogs: async () => {
    await api()?.clearReplyLogs()
    set({ replyLogs: [], replyLogsTotal: 0 })
  },

  deleteReplyLogs: async (ids) => {
    await api()?.deleteReplyLogs(ids)
    const total = await api()?.getReplyLogsCount() || 0
    set({ replyLogsTotal: total })
  },

  fetchDailyStats: async () => {
    const stats = await api()?.getDailyStats()
    if (stats) set({ dailyStats: stats as DailyStats })
  },

  clearContext: async (contactId) => {
    await api()?.clearContext(contactId)
  },

  setupListeners: () => {
    const unsub1 = api()?.onStatusChanged((status: any) => {
      set({ status: status as ServiceStatus })
    }) || (() => {})

    const unsub2 = api()?.onReplySent((log: any) => {
      set((state) => ({
        replyLogs: [...state.replyLogs.slice(-99), log as ReplyLog],
        replyLogsTotal: state.replyLogsTotal + 1
      }))
    }) || (() => {})

    const unsub3 = api()?.onReplyError(() => {
      get().fetchDailyStats()
    }) || (() => {})

    const unsub4 = api()?.onSSEStatusChanged?.((status: any) => {
      if (typeof status === 'string') {
        set({ sseStatus: status as 'disconnected' | 'connecting' | 'connected' | 'error' })
      } else if (status && typeof status === 'object') {
        set({
          sseStatus: (status.status || status) as 'disconnected' | 'connecting' | 'connected' | 'error',
          sseError: status.error || ''
        })
      }
    }) || (() => {})

    const unsub5 = api()?.onProcessingStarted?.((info: any) => {
      set((state) => {
        const existing = state.processingContacts.filter(p => p.contactId !== info.contactId)
        return {
          processingContacts: [...existing, {
            contactId: info.contactId,
            contactName: info.contactName,
            stage: info.stage,
            startedAt: Date.now()
          }]
        }
      })
    }) || (() => {})

    const unsub6 = api()?.onProcessingCompleted?.((info: any) => {
      set((state) => ({
        processingContacts: state.processingContacts.filter(p => p.contactId !== info.contactId)
      }))
    }) || (() => {})

    const unsub7 = api()?.onMessageFlowUpdate?.((info: any) => {
      set((state) => {
        const entry = {
          contactId: info.contactId,
          contactName: info.contactName,
          stage: info.stage,
          detail: info.detail || '',
          timestamp: Date.now()
        }
        const flow = [entry, ...state.messageFlow].slice(0, 50)
        return { messageFlow: flow }
      })
    }) || (() => {})

    const staleTimer = setInterval(() => {
      set((state) => {
        const now = Date.now()
        const active = state.processingContacts.filter(p => now - p.startedAt < 120000)
        if (active.length !== state.processingContacts.length) {
          return { processingContacts: active }
        }
        return state
      })
    }, 10000)

    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
      unsub5()
      unsub6()
      unsub7()
      clearInterval(staleTimer)
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
  },

  setAutoReplyEnabled: async (enabled) => {
    await api()?.setAutoReply(enabled)
    set({ autoReplyEnabled: enabled })
  },

  fetchAutoReplyEnabled: async () => {
    const enabled = await api()?.getAutoReply()
    if (typeof enabled === 'boolean') set({ autoReplyEnabled: enabled })
  },

  fetchSSEStatus: async () => {
    try {
      const result = await api()?.getSSEStatus?.()
      if (result) {
        set({
          sseStatus: (result.status || 'disconnected') as 'disconnected' | 'connecting' | 'connected' | 'error',
          sseError: result.error || ''
        })
      }
    } catch {}
  },

  checkPrerequisites: async () => {
    try {
      const result = await api()?.checkPrerequisites?.()
      if (result) {
        set({
          prerequisiteChecks: result.checks,
          prerequisitesAllPassed: result.allPassed
        })
      }
    } catch {}
  },

  clearTestReply: () => {
    set({ testReplyResult: null, testReplyLatencyMs: undefined })
  },

  clearError: () => {
    set({ error: null })
  },
  setError: (error: string) => {
    set({ error })
  }
}))
