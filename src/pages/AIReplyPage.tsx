import { useState, useEffect } from 'react'
import { useAIReplyStore } from '../stores/aiReplyStore'
import type { ModelConfig, ModelType, Skill, TriggerRules, OllamaConfig, OpenAICompatibleConfig } from '../types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../types/ai-reply'
import {
  Bot, Play, Pause, Square, Plus, Trash2, Settings, TestTube,
  MessageSquare, Zap, Users, Clock, Shield, ChevronRight,
  CheckCircle2, XCircle, Loader2, RefreshCw, Send, Sparkles,
  Brain, UserCircle, Activity, Search, Eye, Edit3, Download,
  FolderDown, FlaskConical
} from 'lucide-react'
import ToggleSwitch from '../components/AIReply/ToggleSwitch'
import TagInput from '../components/AIReply/TagInput'
import TimeRangeSlider from '../components/AIReply/TimeRangeSlider'
import ContactPicker from '../components/AIReply/ContactPicker'
import ModelSelector from '../components/AIReply/ModelSelector'
import SkillImportDialog from '../components/AIReply/SkillImportDialog'
import DistillWizard from '../components/AIReply/DistillWizard'
import SkillDetailEditor from '../components/AIReply/SkillDetailEditor'
import LogDetailDialog from '../components/AIReply/LogDetailDialog'
import AddModelModal from '../components/AIReply/AddModelModal'
import './AIReplyPage.scss'

type TabId = 'dashboard' | 'models' | 'skills' | 'triggers' | 'logs'

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: '概览', icon: Activity },
  { id: 'models', label: '模型配置', icon: Brain },
  { id: 'skills', label: '角色管理', icon: UserCircle },
  { id: 'triggers', label: '触发规则', icon: Zap },
  { id: 'logs', label: '回复日志', icon: MessageSquare }
]

export default function AIReplyPage() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const store = useAIReplyStore()

  useEffect(() => {
    store.fetchStatus()
    store.fetchModels()
    store.fetchSkills()
    store.fetchTriggerRules()
    store.fetchDailyStats()
    store.fetchReplyLogs()
    const cleanup = store.setupListeners()
    return cleanup
  }, [])

  return (
    <div className="ai-reply-page">
      <div className="ai-reply-header">
        <div className="header-left">
          <Bot size={24} />
          <h2>AI 自动回复</h2>
        </div>
        <div className="header-right">
          <StatusBadge status={store.status} />
          <div className="service-controls">
            {store.status === 'stopped' && (
              <button className="btn btn-primary" onClick={() => store.start()} disabled={store.isLoading}>
                {store.isLoading ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                启动
              </button>
            )}
            {store.status === 'running' && (
              <>
                <button className="btn btn-warning" onClick={() => store.pause()}>
                  <Pause size={16} /> 暂停
                </button>
                <button className="btn btn-danger" onClick={() => store.stop()}>
                  <Square size={16} /> 停止
                </button>
              </>
            )}
            {store.status === 'paused' && (
              <>
                <button className="btn btn-primary" onClick={() => store.resume()}>
                  <Play size={16} /> 继续
                </button>
                <button className="btn btn-danger" onClick={() => store.stop()}>
                  <Square size={16} /> 停止
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="ai-reply-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ai-reply-content">
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'models' && <ModelsTab />}
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'triggers' && <TriggersTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    stopped: { label: '已停止', className: 'badge-stopped' },
    running: { label: '运行中', className: 'badge-running' },
    paused: { label: '已暂停', className: 'badge-paused' },
    error: { label: '错误', className: 'badge-error' }
  }
  const c = config[status] || config.stopped
  return <span className={`status-badge ${c.className}`}>{c.label}</span>
}

function DashboardTab() {
  const store = useAIReplyStore()
  const { dailyStats } = store

  return (
    <div className="dashboard-tab">
      <div className="stats-grid">
        <div className="stat-card">
          <MessageSquare size={20} />
          <div className="stat-info">
            <span className="stat-value">{dailyStats.receivedCount}</span>
            <span className="stat-label">收到消息</span>
          </div>
        </div>
        <div className="stat-card">
          <Send size={20} />
          <div className="stat-info">
            <span className="stat-value">{dailyStats.repliedCount}</span>
            <span className="stat-label">已回复</span>
          </div>
        </div>
        <div className="stat-card">
          <Users size={20} />
          <div className="stat-info">
            <span className="stat-value">{dailyStats.activeContacts}</span>
            <span className="stat-label">活跃联系人</span>
          </div>
        </div>
        <div className="stat-card">
          <XCircle size={20} />
          <div className="stat-info">
            <span className="stat-value">{dailyStats.errorCount}</span>
            <span className="stat-label">错误数</span>
          </div>
        </div>
      </div>

      <div className="quick-info">
        <div className="info-section">
          <h3><Brain size={16} /> 当前模型</h3>
          <p>{store.models.find(m => m.id === store.activeModelId)?.name || '未配置'}</p>
        </div>
        <div className="info-section">
          <h3><UserCircle size={16} /> 当前角色</h3>
          <p>{store.skills.find(s => s.id === store.activeSkillId)?.name || '默认助手'}</p>
        </div>
        <div className="info-section">
          <h3><Zap size={16} /> 触发规则</h3>
          <p>{store.triggerRules.enabled ? `已启用 - ${store.triggerRules.listenMode}` : '未启用'}</p>
        </div>
      </div>

      {store.replyLogs.length > 0 && (
        <div className="recent-logs">
          <h3>最近回复</h3>
          {store.replyLogs.slice(-5).reverse().map(log => (
            <div key={log.id} className={`log-item ${log.success ? '' : 'log-error'}`} onClick={() => store.setSelectedLogDetail(log)}>
              <div className="log-header">
                <span className="log-contact">{log.contactName}</span>
                <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="log-body">
                <div className="log-received">{log.receivedMessage}</div>
                <ChevronRight size={14} />
                <div className="log-reply">{log.generatedReply || log.errorMessage}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="quick-actions">
        <button className="btn btn-primary" onClick={() => store.start()} disabled={store.status === 'running'}>
          <Play size={14} /> 启动服务
        </button>
        <button className="btn" onClick={() => store.fetchDailyStats()}>
          <RefreshCw size={14} /> 刷新统计
        </button>
      </div>

      <LogDetailDialog log={store.selectedLogDetail} onClose={() => store.setSelectedLogDetail(null)} />
    </div>
  )
}

function ModelsTab() {
  const store = useAIReplyStore()
  const [showAddModal, setShowAddModal] = useState(false)

  return (
    <div className="models-tab">
      <div className="section-header">
        <h3>模型配置</h3>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={16} />
          添加模型
        </button>
      </div>

      <div className="model-list">
        {store.models.length === 0 ? (
          <div className="empty-state">
            <Brain size={48} />
            <p>暂无模型配置</p>
            <p className="hint">点击"添加模型"配置你的第一个 AI 模型</p>
          </div>
        ) : (
          store.models.map(model => (
            <ModelCard
              key={model.id}
              model={model}
              isActive={model.id === store.activeModelId}
              onActivate={() => store.setActiveModel(model.id)}
              onRemove={() => store.removeModel(model.id)}
              onTest={() => store.testModel(model.id)}
              testResult={store.testResult}
            />
          ))
        )}
      </div>

      <AddModelModal open={showAddModal} onClose={() => setShowAddModal(false)} />
    </div>
  )
}

function ModelCard({
  model, isActive, onActivate, onRemove, onTest, testResult
}: {
  model: ModelConfig
  isActive: boolean
  onActivate: () => void
  onRemove: () => void
  onTest: () => void
  testResult: any
}) {
  return (
    <div className={`model-card ${isActive ? 'active' : ''}`}>
      <div className="model-info">
        <div className="model-header">
          <span className="model-name">{model.name}</span>
          <span className="model-type">{model.type}</span>
          {isActive && <span className="active-badge">使用中</span>}
        </div>
        <div className="model-details">
          {model.type === 'ollama' && (
            <span>{(model.config as OllamaConfig).model} @ {(model.config as OllamaConfig).baseUrl}</span>
          )}
          {['openai', 'claude', 'gemini'].includes(model.type) && (
            <span>{(model.config as OpenAICompatibleConfig).model} @ {(model.config as OpenAICompatibleConfig).baseUrl}</span>
          )}
          {model.type === 'custom' && (
            <span>自定义 API</span>
          )}
        </div>
      </div>
      <div className="model-actions">
        {!isActive && (
          <button className="btn btn-sm" onClick={onActivate}>
            <CheckCircle2 size={14} /> 启用
          </button>
        )}
        <button className="btn btn-sm" onClick={onTest}>
          <TestTube size={14} /> 测试
        </button>
        {!model.id.startsWith('default') && (
          <button className="btn btn-sm btn-danger" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {testResult && (
        <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
          {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {testResult.message}
          {testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
        </div>
      )}
    </div>
  )
}

function SkillsTab() {
  const store = useAIReplyStore()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showDistillWizard, setShowDistillWizard] = useState(false)
  const [showDetailEditor, setShowDetailEditor] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [testSkillId, setTestSkillId] = useState(store.activeSkillId)
  const [testModelId, setTestModelId] = useState(store.activeModelId)

  const handleImported = (skill: Skill) => {
    store.fetchSkills()
  }

  const handleDistillCompleted = (skill: Skill) => {
    store.fetchSkills()
  }

  const handleEditSkill = (skill: Skill) => {
    store.setEditingSkill(skill)
    setShowDetailEditor(true)
  }

  const handleSaveSkill = (skill: Skill) => {
    store.setEditingSkill(null)
    setShowDetailEditor(false)
    store.fetchSkills()
  }

  const handleTest = async () => {
    if (!testMessage.trim()) return
    await store.generateTestReply(testSkillId, testModelId, testMessage)
  }

  if (showDetailEditor && store.editingSkill) {
    return (
      <SkillDetailEditor
        skill={store.editingSkill}
        onSave={handleSaveSkill}
        onCancel={() => { store.setEditingSkill(null); setShowDetailEditor(false) }}
      />
    )
  }

  return (
    <div className="skills-tab">
      <div className="section-header">
        <h3>角色管理</h3>
        <div className="skills-actions">
          <button className="btn btn-primary" onClick={() => setShowDistillWizard(true)}>
            <FlaskConical size={16} /> 蒸馏好友
          </button>
          <button className="btn" onClick={() => setShowImportDialog(true)}>
            <Download size={16} /> 导入
          </button>
          <button className="btn" onClick={() => store.reloadSkills()}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>
      </div>

      <div className="test-section">
        <h4><TestTube size={16} /> 测试回复</h4>
        <div className="test-config">
          <div className="test-select-row">
            <div className="test-select-group">
              <label>角色</label>
              <select value={testSkillId} onChange={e => setTestSkillId(e.target.value)}>
                {store.skills.map(skill => (
                  <option key={skill.id} value={skill.id}>{skill.name}</option>
                ))}
              </select>
            </div>
            <div className="test-select-group">
              <label>模型</label>
              <select value={testModelId} onChange={e => setTestModelId(e.target.value)}>
                {store.models.length === 0 ? (
                  <option value="">暂无模型</option>
                ) : (
                  store.models.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div className="test-input">
            <input
              value={testMessage}
              onChange={e => setTestMessage(e.target.value)}
              placeholder="输入测试消息..."
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTest() } }}
            />
            <button className="btn btn-primary" onClick={handleTest}
              disabled={!testMessage.trim() || store.isLoading || !testModelId}>
              {store.isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              发送
            </button>
          </div>
        </div>
        {store.testReplyResult && (
          <div className="test-reply-result">
            <div className="test-reply-meta">
              <span className="meta-item"><UserCircle size={12} /> {store.skills.find(s => s.id === testSkillId)?.name || '未知角色'}</span>
              <span className="meta-item"><Brain size={12} /> {store.models.find(m => m.id === testModelId)?.name || '未知模型'}</span>
              {store.testReplyLatencyMs != null && (
                <span className="meta-item"><Activity size={12} /> {store.testReplyLatencyMs}ms</span>
              )}
            </div>
            <div className="test-reply-content">
              <Sparkles size={16} className="reply-icon" />
              <p>{store.testReplyResult}</p>
            </div>
            <button className="btn btn-sm test-clear-btn" onClick={() => store.clearTestReply()}>
              清空
            </button>
          </div>
        )}
      </div>

      <div className="skill-list">
        {store.skills.map(skill => (
          <div
            key={skill.id}
            className={`skill-card ${skill.id === store.activeSkillId ? 'active' : ''}`}
            onClick={() => handleEditSkill(skill)}
          >
            <div className="skill-info">
              <div className="skill-header">
                <span className="skill-name">{skill.name}</span>
                <span className="skill-version">v{skill.version}</span>
                {skill.isBuiltin && <span className="builtin-badge">内置</span>}
                {skill.id === store.activeSkillId && <span className="active-badge">使用中</span>}
              </div>
              <p className="skill-desc">{skill.description}</p>
              <div className="skill-tags">
                {skill.persona.identity.tags.map((tag, i) => (
                  <span key={i} className="tag">{tag}</span>
                ))}
              </div>
            </div>
            <div className="skill-actions" onClick={e => e.stopPropagation()}>
              {skill.id !== store.activeSkillId && (
                <button className="btn btn-sm" onClick={() => store.setActiveSkill(skill.id)}>
                  <CheckCircle2 size={14} /> 启用
                </button>
              )}
              <button className="btn btn-sm" onClick={() => handleEditSkill(skill)}>
                <Edit3 size={14} /> 编辑
              </button>
              {!skill.isBuiltin && (
                <button className="btn btn-sm btn-danger" onClick={() => store.removeSkill(skill.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <SkillImportDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImported={handleImported}
      />
      <DistillWizard
        open={showDistillWizard}
        onClose={() => setShowDistillWizard(false)}
        onCompleted={handleDistillCompleted}
      />
    </div>
  )
}

function TriggersTab() {
  const store = useAIReplyStore()
  const [rules, setRules] = useState<TriggerRules>(store.triggerRules)

  useEffect(() => {
    setRules(store.triggerRules)
  }, [store.triggerRules])

  const handleSave = async () => {
    await store.setTriggerRules(rules)
  }

  const updateRule = <K extends keyof TriggerRules>(key: K, value: TriggerRules[K]) => {
    setRules(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="triggers-tab">
      <div className="section-header">
        <h3>触发规则</h3>
        <button className="btn btn-primary" onClick={handleSave}>
          <Settings size={16} /> 保存
        </button>
      </div>

      <div className="rule-group">
        <div className="rule-group-title"><Zap size={16} /> 基础开关</div>
        <div className="toggle-row">
          <span className="toggle-label-text">启用自动回复</span>
          <ToggleSwitch checked={rules.enabled} onChange={v => updateRule('enabled', v)} />
        </div>
      </div>

      <div className="rule-group">
        <div className="rule-group-title"><Users size={16} /> 回复对象</div>
        <div className="form-group">
          <label>监听模式</label>
          <select value={rules.listenMode}
            onChange={e => updateRule('listenMode', e.target.value as any)}>
            <option value="all">所有人</option>
            <option value="specific">指定联系人</option>
            <option value="whitelist">白名单</option>
            <option value="blacklist">黑名单</option>
          </select>
        </div>
        {(rules.listenMode === 'specific' || rules.listenMode === 'whitelist') && (
          <div className="form-group">
            <label>选择联系人</label>
            <ContactPicker
              selectedIds={rules.targetContacts}
              onChange={ids => updateRule('targetContacts', ids)}
            />
          </div>
        )}
        {rules.listenMode === 'blacklist' && (
          <div className="form-group">
            <label>黑名单联系人</label>
            <ContactPicker
              selectedIds={rules.blacklist}
              onChange={ids => updateRule('blacklist', ids)}
            />
          </div>
        )}
      </div>

      <div className="rule-group">
        <div className="rule-group-title"><Search size={16} /> 关键词规则</div>
        <div className="form-group">
          <label>包含关键词（匹配任一触发）</label>
          <TagInput
            tags={rules.keywords.include}
            onChange={tags => updateRule('keywords', { ...rules.keywords, include: tags })}
            placeholder="输入关键词后回车添加"
          />
        </div>
        <div className="form-group">
          <label>排除关键词（匹配任一跳过）</label>
          <TagInput
            tags={rules.keywords.exclude}
            onChange={tags => updateRule('keywords', { ...rules.keywords, exclude: tags })}
            placeholder="输入关键词后回车添加"
          />
        </div>
      </div>

      <div className="rule-group">
        <div className="rule-group-title"><MessageSquare size={16} /> 群聊规则</div>
        <div className="toggle-row">
          <span className="toggle-label-text">群聊 @触发</span>
          <ToggleSwitch checked={rules.triggerOnAt} onChange={v => updateRule('triggerOnAt', v)} />
        </div>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <span className="toggle-label-text">@所有人触发</span>
          <ToggleSwitch checked={rules.triggerOnAtAll} onChange={v => updateRule('triggerOnAtAll', v)} />
        </div>
      </div>

      <div className="rule-group">
        <div className="rule-group-title"><Clock size={16} /> 时间规则</div>
        <div className="toggle-row">
          <span className="toggle-label-text">启用时间限制</span>
          <ToggleSwitch
            checked={rules.timeRules.enabled}
            onChange={v => updateRule('timeRules', { ...rules.timeRules, enabled: v })}
          />
        </div>
        {rules.timeRules.enabled && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>允许回复的时间范围</label>
            <TimeRangeSlider
              value={rules.timeRules.allowedHours}
              onChange={v => updateRule('timeRules', { ...rules.timeRules, allowedHours: v })}
            />
          </div>
        )}
      </div>

      <div className="rule-group">
        <div className="rule-group-title"><Shield size={16} /> 频率限制</div>
        <div className="toggle-row">
          <span className="toggle-label-text">启用频率限制</span>
          <ToggleSwitch
            checked={rules.rateLimit.enabled}
            onChange={v => updateRule('rateLimit', { ...rules.rateLimit, enabled: v })}
          />
        </div>
        {rules.rateLimit.enabled && (
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label>每分钟最大回复数</label>
              <input type="number" min="1" max="60" value={rules.rateLimit.maxRepliesPerMinute}
                onChange={e => updateRule('rateLimit', {
                  ...rules.rateLimit,
                  maxRepliesPerMinute: parseInt(e.target.value)
                })} />
            </div>
            <div className="form-group">
              <label>冷却时间 (秒)</label>
              <input type="number" min="0" max="300" value={rules.rateLimit.cooldownSeconds}
                onChange={e => updateRule('rateLimit', {
                  ...rules.rateLimit,
                  cooldownSeconds: parseInt(e.target.value)
                })} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LogsTab() {
  const store = useAIReplyStore()
  const [statusFilter, setStatusFilter] = useState('')
  const [contactFilter, setContactFilter] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const pageSize = 20

  useEffect(() => {
    store.fetchReplyLogs(pageSize, (page - 1) * pageSize)
    store.fetchReplyLogsCount()
  }, [page])

  const filteredLogs = store.replyLogs.filter(log => {
    if (statusFilter === 'success' && !log.success) return false
    if (statusFilter === 'error' && log.success) return false
    if (contactFilter && !log.contactName.includes(contactFilter)) return false
    if (keywordFilter && !log.receivedMessage.includes(keywordFilter) && !log.generatedReply.includes(keywordFilter)) return false
    return true
  })

  const totalPages = Math.ceil(store.replyLogsTotal / pageSize)

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLogs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredLogs.map(l => l.id)))
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return
    await store.deleteReplyLogs([...selectedIds])
    setSelectedIds(new Set())
    store.fetchReplyLogs(pageSize, (page - 1) * pageSize)
  }

  const handleClearAll = async () => {
    await store.clearReplyLogs()
    setSelectedIds(new Set())
  }

  return (
    <div className="logs-tab">
      <div className="section-header">
        <h3>回复日志 <span className="log-count">({store.replyLogsTotal} 条)</span></h3>
        <div className="log-actions">
          <button className="btn" onClick={() => { store.fetchReplyLogs(pageSize, (page - 1) * pageSize); store.fetchReplyLogsCount() }}>
            <RefreshCw size={16} /> 刷新
          </button>
          {selectedIds.size > 0 && (
            <button className="btn btn-danger" onClick={handleDeleteSelected}>
              <Trash2 size={16} /> 删除选中 ({selectedIds.size})
            </button>
          )}
          <button className="btn btn-danger" onClick={handleClearAll}>
            <Trash2 size={16} /> 清空全部
          </button>
        </div>
      </div>

      <div className="log-filters">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">失败</option>
        </select>
        <input
          value={contactFilter}
          onChange={e => setContactFilter(e.target.value)}
          placeholder="联系人筛选..."
        />
        <input
          value={keywordFilter}
          onChange={e => setKeywordFilter(e.target.value)}
          placeholder="关键词搜索..."
        />
      </div>

      {filteredLogs.length === 0 ? (
        <div className="empty-state">
          <MessageSquare size={48} />
          <p>暂无回复日志</p>
        </div>
      ) : (
        <>
          <div className="log-select-bar">
            <label className="select-all-label">
              <input
                type="checkbox"
                checked={selectedIds.size === filteredLogs.length && filteredLogs.length > 0}
                onChange={toggleSelectAll}
              />
              <span>全选本页</span>
            </label>
          </div>
          <div className="log-list">
            {filteredLogs.map(log => (
              <div
                key={log.id}
                className={`log-item ${log.success ? '' : 'log-error'} ${selectedIds.has(log.id) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  className="log-checkbox"
                  checked={selectedIds.has(log.id)}
                  onChange={() => toggleSelect(log.id)}
                  onClick={e => e.stopPropagation()}
                />
                <div className="log-content" onClick={() => store.setSelectedLogDetail(log)}>
                  <div className="log-header">
                    <span className="log-contact">{log.contactName}</span>
                    <span className="log-meta">
                      {log.skillName} · {log.modelName} · {log.latencyMs}ms
                    </span>
                    <span className="log-time">{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="log-body">
                    <div className="log-received">{log.receivedMessage}</div>
                    <ChevronRight size={14} />
                    <div className="log-reply">{log.generatedReply || log.errorMessage}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="log-pagination">
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span className="page-info">第 {page} / {totalPages} 页</span>
              <button className="btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                下一页
              </button>
            </div>
          )}
        </>
      )}

      <LogDetailDialog log={store.selectedLogDetail} onClose={() => store.setSelectedLogDetail(null)} />
    </div>
  )
}
