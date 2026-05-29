import { useState, useEffect } from 'react'
import { X, Save, Eye } from 'lucide-react'
import TagInput from './TagInput'
import type { Skill, PersonaIdentity, SpeechStyle } from '../../types/ai-reply'
import './SkillDetailEditor.scss'

interface SkillDetailEditorProps {
  skill: Skill
  onSave: (skill: Skill) => void
  onCancel: () => void
}

type EditorTab = 'basic' | 'identity' | 'speech' | 'rules' | 'values' | 'memory' | 'strategy' | 'prompt'

const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: 'basic', label: '基本信息' },
  { id: 'identity', label: '身份信息' },
  { id: 'speech', label: '说话风格' },
  { id: 'rules', label: '行为规则' },
  { id: 'values', label: '核心价值观' },
  { id: 'memory', label: '重要记忆' },
  { id: 'strategy', label: '回复策略' },
  { id: 'prompt', label: '系统提示词' }
]

export default function SkillDetailEditor({ skill, onSave, onCancel }: SkillDetailEditorProps) {
  const [editData, setEditData] = useState<Skill>(JSON.parse(JSON.stringify(skill)))
  const [activeTab, setActiveTab] = useState<EditorTab>('basic')
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    setEditData(JSON.parse(JSON.stringify(skill)))
  }, [skill])

  const updateField = <K extends keyof Skill>(key: K, value: Skill[K]) => {
    setEditData(prev => ({ ...prev, [key]: value }))
  }

  const updateIdentity = (patch: Partial<PersonaIdentity>) => {
    setEditData(prev => ({
      ...prev,
      persona: {
        ...prev.persona,
        identity: { ...prev.persona.identity, ...patch }
      }
    }))
  }

  const updateSpeechStyle = (patch: Partial<SpeechStyle>) => {
    setEditData(prev => ({
      ...prev,
      persona: {
        ...prev.persona,
        speechStyle: { ...prev.persona.speechStyle, ...patch }
      }
    }))
  }

  const updateBehavioralRule = (index: number, value: string) => {
    setEditData(prev => {
      const rules = [...prev.persona.behavioralRules]
      rules[index] = value
      return { ...prev, persona: { ...prev.persona, behavioralRules: rules } }
    })
  }

  const addBehavioralRule = () => {
    setEditData(prev => ({
      ...prev,
      persona: {
        ...prev.persona,
        behavioralRules: [...prev.persona.behavioralRules, '']
      }
    }))
  }

  const removeBehavioralRule = (index: number) => {
    setEditData(prev => ({
      ...prev,
      persona: {
        ...prev.persona,
        behavioralRules: prev.persona.behavioralRules.filter((_, i) => i !== index)
      }
    }))
  }

  const updateValue = (index: number, value: string) => {
    setEditData(prev => {
      const values = [...prev.selfMemory.values]
      values[index] = value
      return { ...prev, selfMemory: { ...prev.selfMemory, values } }
    })
  }

  const addValue = () => {
    setEditData(prev => ({
      ...prev,
      selfMemory: { ...prev.selfMemory, values: [...prev.selfMemory.values, ''] }
    }))
  }

  const removeValue = (index: number) => {
    setEditData(prev => ({
      ...prev,
      selfMemory: { ...prev.selfMemory, values: prev.selfMemory.values.filter((_, i) => i !== index) }
    }))
  }

  const updateExperience = (index: number, value: string) => {
    setEditData(prev => {
      const experiences = [...prev.selfMemory.experiences]
      experiences[index] = value
      return { ...prev, selfMemory: { ...prev.selfMemory, experiences } }
    })
  }

  const addExperience = () => {
    setEditData(prev => ({
      ...prev,
      selfMemory: { ...prev.selfMemory, experiences: [...prev.selfMemory.experiences, ''] }
    }))
  }

  const removeExperience = (index: number) => {
    setEditData(prev => ({
      ...prev,
      selfMemory: { ...prev.selfMemory, experiences: prev.selfMemory.experiences.filter((_, i) => i !== index) }
    }))
  }

  const generateSystemPrompt = () => {
    const { persona, selfMemory, replyStrategy } = editData
    let prompt = `你是${persona.identity.role}。`
    if (persona.identity.age) prompt += `年龄${persona.identity.age}岁。`
    if (persona.identity.occupation) prompt += `职业是${persona.identity.occupation}。`
    if (persona.identity.mbti) prompt += `MBTI类型为${persona.identity.mbti}。`
    prompt += `\n\n背景：${selfMemory.background}`
    if (selfMemory.values.length > 0) {
      prompt += `\n\n核心价值观：${selfMemory.values.filter(v => v).join('、')}`
    }
    if (persona.speechStyle.tone) {
      prompt += `\n\n说话风格：${persona.speechStyle.tone}`
    }
    if (persona.speechStyle.vocabulary.length > 0) {
      prompt += `\n常用词汇：${persona.speechStyle.vocabulary.join('、')}`
    }
    if (persona.speechStyle.sentencePatterns.length > 0) {
      prompt += `\n常用句式：${persona.speechStyle.sentencePatterns.join('、')}`
    }
    if (persona.speechStyle.emojiUsage) {
      prompt += `\n表情使用：${persona.speechStyle.emojiUsage}`
    }
    if (persona.behavioralRules.length > 0) {
      prompt += `\n\n行为规则：\n${persona.behavioralRules.filter(r => r).map(r => `- ${r}`).join('\n')}`
    }
    if (selfMemory.experiences.length > 0) {
      prompt += `\n\n重要经历：\n${selfMemory.experiences.filter(e => e).map(e => `- ${e}`).join('\n')}`
    }
    prompt += `\n\n回复策略：回复延迟${replyStrategy.responseDelay.min}-${replyStrategy.responseDelay.max}ms，最大长度${replyStrategy.maxReplyLength}字。`
    return prompt
  }

  return (
    <div className="skill-detail-editor">
      <div className="editor-header">
        <h3>编辑角色 - {editData.name}</h3>
        <div className="editor-actions">
          <button className="btn btn-secondary" onClick={() => setShowPreview(!showPreview)}>
            <Eye size={14} /> 预览
          </button>
          <button className="btn btn-primary" onClick={() => onSave(editData)}>
            <Save size={14} /> 保存
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            <X size={14} /> 取消
          </button>
        </div>
      </div>

      <div className="editor-tabs">
        {EDITOR_TABS.map(tab => (
          <button
            key={tab.id}
            className={`editor-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="editor-content">
        {activeTab === 'basic' && (
          <div className="editor-section">
            <div className="form-group">
              <label>名称</label>
              <input value={editData.name} onChange={e => updateField('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>描述</label>
              <textarea value={editData.description} onChange={e => updateField('description', e.target.value)} rows={3} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>版本</label>
                <input value={editData.version} onChange={e => updateField('version', e.target.value)} />
              </div>
              <div className="form-group">
                <label>作者</label>
                <input value={editData.author || ''} onChange={e => updateField('author', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'identity' && (
          <div className="editor-section">
            <div className="form-group">
              <label>角色</label>
              <input value={editData.persona.identity.role} onChange={e => updateIdentity({ role: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>年龄</label>
                <input type="number" value={editData.persona.identity.age || ''} onChange={e => updateIdentity({ age: e.target.value ? parseInt(e.target.value) : undefined })} />
              </div>
              <div className="form-group">
                <label>职业</label>
                <input value={editData.persona.identity.occupation || ''} onChange={e => updateIdentity({ occupation: e.target.value || undefined })} />
              </div>
            </div>
            <div className="form-group">
              <label>MBTI</label>
              <input value={editData.persona.identity.mbti || ''} onChange={e => updateIdentity({ mbti: e.target.value || undefined })} placeholder="如 INTJ" />
            </div>
            <div className="form-group">
              <label>标签</label>
              <TagInput
                tags={editData.persona.identity.tags}
                onChange={tags => updateIdentity({ tags })}
                placeholder="输入标签后回车添加"
              />
            </div>
          </div>
        )}

        {activeTab === 'speech' && (
          <div className="editor-section">
            <div className="form-group">
              <label>语气</label>
              <input value={editData.persona.speechStyle.tone} onChange={e => updateSpeechStyle({ tone: e.target.value })} />
            </div>
            <div className="form-group">
              <label>常用词汇</label>
              <TagInput
                tags={editData.persona.speechStyle.vocabulary}
                onChange={vocabulary => updateSpeechStyle({ vocabulary })}
                placeholder="输入词汇后回车添加"
              />
            </div>
            <div className="form-group">
              <label>常用句式</label>
              <TagInput
                tags={editData.persona.speechStyle.sentencePatterns}
                onChange={sentencePatterns => updateSpeechStyle({ sentencePatterns })}
                placeholder="输入句式后回车添加"
              />
            </div>
            <div className="form-group">
              <label>表情使用</label>
              <input value={editData.persona.speechStyle.emojiUsage} onChange={e => updateSpeechStyle({ emojiUsage: e.target.value })} />
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="editor-section">
            <label className="section-label">行为规则</label>
            {editData.persona.behavioralRules.map((rule, i) => (
              <div key={i} className="list-item-row">
                <input value={rule} onChange={e => updateBehavioralRule(i, e.target.value)} />
                <button className="remove-btn" onClick={() => removeBehavioralRule(i)}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button className="add-btn" onClick={addBehavioralRule}>+ 添加规则</button>
          </div>
        )}

        {activeTab === 'values' && (
          <div className="editor-section">
            <div className="form-group">
              <label>背景</label>
              <textarea value={editData.selfMemory.background} onChange={e => setEditData(prev => ({ ...prev, selfMemory: { ...prev.selfMemory, background: e.target.value } }))} rows={3} />
            </div>
            <label className="section-label">核心价值观</label>
            {editData.selfMemory.values.map((v, i) => (
              <div key={i} className="list-item-row">
                <input value={v} onChange={e => updateValue(i, e.target.value)} />
                <button className="remove-btn" onClick={() => removeValue(i)}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button className="add-btn" onClick={addValue}>+ 添加价值观</button>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="editor-section">
            <label className="section-label">重要经历</label>
            {editData.selfMemory.experiences.map((exp, i) => (
              <div key={i} className="list-item-row">
                <input value={exp} onChange={e => updateExperience(i, e.target.value)} />
                <button className="remove-btn" onClick={() => removeExperience(i)}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button className="add-btn" onClick={addExperience}>+ 添加经历</button>
          </div>
        )}

        {activeTab === 'strategy' && (
          <div className="editor-section">
            <div className="form-row">
              <div className="form-group">
                <label>最小回复延迟 (ms)</label>
                <input type="number" value={editData.replyStrategy.responseDelay.min} onChange={e => setEditData(prev => ({ ...prev, replyStrategy: { ...prev.replyStrategy, responseDelay: { ...prev.replyStrategy.responseDelay, min: parseInt(e.target.value) || 0 } } }))} />
              </div>
              <div className="form-group">
                <label>最大回复延迟 (ms)</label>
                <input type="number" value={editData.replyStrategy.responseDelay.max} onChange={e => setEditData(prev => ({ ...prev, replyStrategy: { ...prev.replyStrategy, responseDelay: { ...prev.replyStrategy.responseDelay, max: parseInt(e.target.value) || 0 } } }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>打字速度</label>
                <input type="number" value={editData.replyStrategy.typingSpeed} onChange={e => setEditData(prev => ({ ...prev, replyStrategy: { ...prev.replyStrategy, typingSpeed: parseInt(e.target.value) || 0 } }))} />
              </div>
              <div className="form-group">
                <label>最大回复长度</label>
                <input type="number" value={editData.replyStrategy.maxReplyLength} onChange={e => setEditData(prev => ({ ...prev, replyStrategy: { ...prev.replyStrategy, maxReplyLength: parseInt(e.target.value) || 0 } }))} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'prompt' && (
          <div className="editor-section">
            <div className="form-group">
              <label>系统提示词模板</label>
              <textarea
                value={editData.systemPromptTemplate}
                onChange={e => updateField('systemPromptTemplate', e.target.value)}
                rows={12}
                placeholder="自定义系统提示词模板，留空则自动生成"
              />
            </div>
            {showPreview && (
              <div className="prompt-preview">
                <label className="section-label">自动生成预览</label>
                <pre>{generateSystemPrompt()}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
