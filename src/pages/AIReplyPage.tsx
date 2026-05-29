import { useState, useEffect, useCallback } from 'react'
import { useAIReplyStore } from '../stores/aiReplyStore'
import type { ModelConfig, ModelType, Skill, TriggerRules, OllamaConfig, OpenAICompatibleConfig } from '../types/ai-reply'
import { DEFAULT_TRIGGER_RULES } from '../types/ai-reply'
import {
  Bot, Play, Pause, Square, Plus, Trash2, Settings, TestTube,
  MessageSquare, Zap, Users, Clock, Shield, ChevronRight,
  CheckCircle2, XCircle, Loader2, RefreshCw, Send, Sparkles,
  Brain, UserCircle, Activity
} from 'lucide-react'
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
            <span className="stat-label">错误</span>
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
            <div key={log.id} className={`log-item ${log.success ? '' : 'log-error'}`}>
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
    </div>
  )
}

function ModelsTab() {
  const store = useAIReplyStore()
  const [showAddModel, setShowAddModel] = useState(false)

  return (
    <div className="models-tab">
      <div className="section-header">
        <h3>模型配置</h3>
        <button className="btn btn-primary" onClick={() => setShowAddModel(true)}>
          <Plus size={16} /> 添加模型
        </button>
      </div>

      {showAddModel && (
        <AddModelForm onClose={() => setShowAddModel(false)} />
      )}

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

function AddModelForm({ onClose }: { onClose: () => void }) {
  const store = useAIReplyStore()
  const [type, setType] = useState<ModelType>('ollama')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-r1:7b')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)

  const handleSubmit = async () => {
    if (!name || !model) return

    let config: any
    if (type === 'ollama') {
      config = { baseUrl, model, temperature, maxTokens }
    } else {
      config = { apiKey, baseUrl, model, temperature, maxTokens }
    }

    const modelConfig: ModelConfig = {
      id: `${type}-${Date.now()}`,
      name,
      type,
      enabled: true,
      config
    }

    await store.addModel(modelConfig)
    onClose()
  }

  return (
    <div className="add-model-form">
      <h4>添加模型</h4>
      <div className="form-group">
        <label>模型类型</label>
        <select value={type} onChange={e => setType(e.target.value as ModelType)}>
          <option value="ollama">Ollama (本地)</option>
          <option value="openai">OpenAI 兼容</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
          <option value="custom">自定义 API</option>
        </select>
      </div>
      <div className="form-group">
        <label>名称</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="例如: DeepSeek R1" />
      </div>
      <div className="form-group">
        <label>API 地址</label>
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
          placeholder={type === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'} />
      </div>
      {type !== 'ollama' && type !== 'custom' && (
        <div className="form-group">
          <label>API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
        </div>
      )}
      <div className="form-group">
        <label>模型名称</label>
        <input value={model} onChange={e => setModel(e.target.value)}
          placeholder={type === 'ollama' ? 'deepseek-r1:7b' : 'gpt-4o'} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Temperature</label>
          <input type="number" min="0" max="2" step="0.1" value={temperature}
            onChange={e => setTemperature(parseFloat(e.target.value))} />
        </div>
        <div className="form-group">
          <label>Max Tokens</label>
          <input type="number" min="1" max="32768" value={maxTokens}
            onChange={e => setMaxTokens(parseInt(e.target.value))} />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={handleSubmit}>添加</button>
      </div>
    </div>
  )
}

function SkillsTab() {
  const store = useAIReplyStore()
  const [testMessage, setTestMessage] = useState('')
  const [testSkillId, setTestSkillId] = useState('')

  const handleTest = async (skillId: string) => {
    if (!testMessage) return
    setTestSkillId(skillId)
    await store.generateTestReply(skillId, testMessage)
  }

  return (
    <div className="skills-tab">
      <div className="section-header">
        <h3>角色管理</h3>
        <button className="btn" onClick={() => store.reloadSkills()}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      <div className="skill-list">
        {store.skills.map(skill => (
          <div key={skill.id} className={`skill-card ${skill.id === store.activeSkillId ? 'active' : ''}`}>
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
            <div className="skill-actions">
              {skill.id !== store.activeSkillId && (
                <button className="btn btn-sm" onClick={() => store.setActiveSkill(skill.id)}>
                  <CheckCircle2 size={14} /> 启用
                </button>
              )}
              {!skill.isBuiltin && (
                <button className="btn btn-sm btn-danger" onClick={() => store.removeSkill(skill.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="test-section">
        <h4>测试回复</h4>
        <div className="test-input">
          <input
            value={testMessage}
            onChange={e => setTestMessage(e.target.value)}
            placeholder="输入测试消息..."
          />
          <button className="btn btn-primary" onClick={() => handleTest(store.activeSkillId)}
            disabled={!testMessage || store.isLoading}>
            {store.isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            发送
          </button>
        </div>
        {store.testReplyResult && (
          <div className="test-result">
            <Sparkles size={16} />
            <p>{store.testReplyResult}</p>
          </div>
        )}
      </div>
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

      <div className="form-group">
        <label className="switch-label">
          <input type="checkbox" checked={rules.enabled}
            onChange={e => updateRule('enabled', e.target.checked)} />
          <span>启用自动回复</span>
        </label>
      </div>

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

      <div className="form-group">
        <label className="switch-label">
          <input type="checkbox" checked={rules.triggerOnAt}
            onChange={e => updateRule('triggerOnAt', e.target.checked)} />
          <span>群聊 @触发</span>
        </label>
      </div>

      <div className="form-group">
        <label className="switch-label">
          <input type="checkbox" checked={rules.timeRules.enabled}
            onChange={e => updateRule('timeRules', { ...rules.timeRules, enabled: e.target.checked })} />
          <span>时间限制</span>
        </label>
      </div>

      {rules.timeRules.enabled && (
        <div className="form-row">
          <div className="form-group">
            <label>开始时间</label>
            <input type="number" min="0" max="23" value={rules.timeRules.allowedHours[0]}
              onChange={e => updateRule('timeRules', {
                ...rules.timeRules,
                allowedHours: [parseInt(e.target.value), rules.timeRules.allowedHours[1]]
              })} />
          </div>
          <div className="form-group">
            <label>结束时间</label>
            <input type="number" min="0" max="23" value={rules.timeRules.allowedHours[1]}
              onChange={e => updateRule('timeRules', {
                ...rules.timeRules,
                allowedHours: [rules.timeRules.allowedHours[0], parseInt(e.target.value)]
              })} />
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="switch-label">
          <input type="checkbox" checked={rules.rateLimit.enabled}
            onChange={e => updateRule('rateLimit', { ...rules.rateLimit, enabled: e.target.checked })} />
          <span>频率限制</span>
        </label>
      </div>

      {rules.rateLimit.enabled && (
        <div className="form-row">
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
  )
}

function LogsTab() {
  const store = useAIReplyStore()

  return (
    <div className="logs-tab">
      <div className="section-header">
        <h3>回复日志</h3>
        <div className="log-actions">
          <button className="btn" onClick={() => store.fetchReplyLogs()}>
            <RefreshCw size={16} /> 刷新
          </button>
          <button className="btn btn-danger" onClick={() => store.clearReplyLogs()}>
            <Trash2 size={16} /> 清空
          </button>
        </div>
      </div>

      {store.replyLogs.length === 0 ? (
        <div className="empty-state">
          <MessageSquare size={48} />
          <p>暂无回复日志</p>
        </div>
      ) : (
        <div className="log-list">
          {store.replyLogs.slice().reverse().map(log => (
            <div key={log.id} className={`log-item ${log.success ? '' : 'log-error'}`}>
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
          ))}
        </div>
      )}
    </div>
  )
}
