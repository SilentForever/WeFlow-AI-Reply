import { useState, useEffect, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, Loader2, CheckCircle2, Search } from 'lucide-react'
import ContactPicker from './ContactPicker'
import TimeRangeSlider from './TimeRangeSlider'
import ModelSelector from './ModelSelector'
import type { Skill, DistillProgress, ModelType } from '../../types/ai-reply'
import './DistillWizard.scss'

interface DistillWizardProps {
  open: boolean
  onClose: () => void
  onCompleted: (skill: Skill) => void
}

type WizardStep = 1 | 2 | 3 | 4

const STEPS = [
  { num: 1, label: '选择好友' },
  { num: 2, label: '聊天记录范围' },
  { num: 3, label: '蒸馏配置' },
  { num: 4, label: '蒸馏进行中' }
]

export default function DistillWizard({ open, onClose, onCompleted }: DistillWizardProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [messageLimit, setMessageLimit] = useState(500)
  const [useTimeRange, setUseTimeRange] = useState(false)
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 23])
  const [modelType, setModelType] = useState<ModelType>('openai')
  const [modelBaseUrl, setModelBaseUrl] = useState('https://api.openai.com/v1')
  const [modelApiKey, setModelApiKey] = useState('')
  const [modelName, setModelName] = useState('gpt-4o')
  const [distillDepth, setDistillDepth] = useState(3)
  const [distillDimensions, setDistillDimensions] = useState(5)
  const [skillName, setSkillName] = useState('')
  const [progress, setProgress] = useState<DistillProgress | null>(null)
  const [taskId, setTaskId] = useState('')
  const [error, setError] = useState('')
  const [completedSkill, setCompletedSkill] = useState<Skill | null>(null)

  const pollProgress = useCallback(async () => {
    if (!taskId) return
    try {
      const p = await window.electronAPI?.aiReply?.getDistillProgress(taskId)
      if (p) {
        setProgress(p as DistillProgress)
        if ((p as DistillProgress).status === 'completed') {
          const result = await window.electronAPI?.aiReply?.getDistillResult(taskId)
          if (result) {
            setCompletedSkill(result as Skill)
          }
        } else if ((p as DistillProgress).status === 'error') {
          setError((p as DistillProgress).error || '蒸馏失败')
        }
      }
    } catch {}
  }, [taskId])

  useEffect(() => {
    if (step !== 4 || !taskId) return
    const interval = setInterval(pollProgress, 2000)
    return () => clearInterval(interval)
  }, [step, taskId, pollProgress])

  if (!open) return null

  const canNext = () => {
    if (step === 1) return selectedContactIds.length > 0
    if (step === 2) return messageLimit > 0
    if (step === 3) return !!modelName && !!skillName
    return false
  }

  const handleStartDistill = async () => {
    setError('')
    try {
      const id = await window.electronAPI?.aiReply?.startDistill({
        contactIds: selectedContactIds,
        messageLimit,
        useTimeRange,
        timeRange: useTimeRange ? timeRange : undefined,
        modelType,
        modelBaseUrl,
        modelApiKey,
        modelName,
        depth: distillDepth,
        dimensions: distillDimensions,
        skillName
      })
      if (id) {
        setTaskId(id)
        setStep(4)
      }
    } catch (e: any) {
      setError(e.message || '启动蒸馏失败')
    }
  }

  const handleSave = async () => {
    if (!completedSkill) return
    try {
      const saved = await window.electronAPI?.aiReply?.saveDistillSkill(taskId)
      if (saved) {
        onCompleted(saved as Skill)
        onClose()
      }
    } catch (e: any) {
      setError(e.message || '保存失败')
    }
  }

  const handleCancelDistill = async () => {
    if (taskId) {
      try {
        await window.electronAPI?.aiReply?.cancelDistill(taskId)
      } catch {}
    }
    onClose()
  }

  return (
    <div className="distill-overlay" onClick={onClose}>
      <div className="distill-wizard" onClick={e => e.stopPropagation()}>
        <div className="wizard-header">
          <h3>蒸馏好友角色</h3>
          <button className="dialog-close" onClick={step === 4 ? handleCancelDistill : onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="wizard-steps">
          {STEPS.map(s => (
            <div key={s.num} className={`wizard-step ${step >= s.num ? 'active' : ''} ${step > s.num ? 'done' : ''}`}>
              <span className="step-num">{step > s.num ? <CheckCircle2 size={16} /> : s.num}</span>
              <span className="step-label">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="wizard-body">
          {step === 1 && (
            <div className="step-content">
              <div className="step-title">选择要蒸馏的好友</div>
              <div className="step-desc">选择一个或多个好友，将根据与他们的聊天记录蒸馏出角色特征</div>
              <ContactPicker
                selectedIds={selectedContactIds}
                onChange={setSelectedContactIds}
              />
            </div>
          )}

          {step === 2 && (
            <div className="step-content">
              <div className="step-title">选择聊天记录范围</div>
              <div className="form-group">
                <label>消息数量限制</label>
                <input
                  type="number"
                  min={50}
                  max={10000}
                  value={messageLimit}
                  onChange={e => setMessageLimit(parseInt(e.target.value) || 500)}
                />
              </div>
              <div className="form-group">
                <label className="toggle-label-row">
                  <span>使用时间范围</span>
                  <input type="checkbox" checked={useTimeRange} onChange={e => setUseTimeRange(e.target.checked)} />
                </label>
              </div>
              {useTimeRange && (
                <div className="form-group">
                  <label>时间范围</label>
                  <TimeRangeSlider value={timeRange} onChange={setTimeRange} />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="step-content">
              <div className="step-title">蒸馏配置</div>
              <div className="form-group">
                <label>模型类型</label>
                <select value={modelType} onChange={e => setModelType(e.target.value as ModelType)}>
                  <option value="ollama">Ollama</option>
                  <option value="openai">OpenAI 兼容</option>
                  <option value="claude">Claude</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
              <div className="form-group">
                <label>API 地址</label>
                <input value={modelBaseUrl} onChange={e => setModelBaseUrl(e.target.value)} />
              </div>
              {modelType !== 'ollama' && (
                <div className="form-group">
                  <label>API Key</label>
                  <input type="password" value={modelApiKey} onChange={e => setModelApiKey(e.target.value)} />
                </div>
              )}
              <div className="form-group">
                <label>模型名称</label>
                <ModelSelector
                  type={modelType}
                  baseUrl={modelBaseUrl}
                  apiKey={modelApiKey}
                  value={modelName}
                  onChange={setModelName}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>蒸馏深度</label>
                  <input type="number" min={1} max={10} value={distillDepth} onChange={e => setDistillDepth(parseInt(e.target.value) || 3)} />
                </div>
                <div className="form-group">
                  <label>蒸馏维度</label>
                  <input type="number" min={1} max={20} value={distillDimensions} onChange={e => setDistillDimensions(parseInt(e.target.value) || 5)} />
                </div>
              </div>
              <div className="form-group">
                <label>角色名称</label>
                <input value={skillName} onChange={e => setSkillName(e.target.value)} placeholder="为蒸馏出的角色命名" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="step-content">
              <div className="step-title">
                {completedSkill ? '蒸馏完成' : '蒸馏进行中...'}
              </div>
              {progress && !completedSkill && (
                <div className="distill-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress.totalRounds > 0 ? Math.round((progress.currentRound / progress.totalRounds) * 100) : 0}%` }} />
                  </div>
                  <div className="progress-info">
                    <span>{progress.status}</span>
                    <span>{progress.totalRounds > 0 ? Math.round((progress.currentRound / progress.totalRounds) * 100) : 0}%</span>
                  </div>
                  <div className="progress-steps">
                    轮次 {progress.currentRound}/{progress.totalRounds}
                  </div>
                </div>
              )}
              {completedSkill && (
                <div className="distill-result">
                  <CheckCircle2 size={48} className="result-icon" />
                  <h4>{completedSkill.name}</h4>
                  <p>{completedSkill.description}</p>
                  <div className="result-tags">
                    {completedSkill.persona.identity.tags.map((tag, i) => (
                      <span key={i} className="result-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {error && <div className="distill-error">{error}</div>}
            </div>
          )}
        </div>

        <div className="wizard-footer">
          {step > 1 && step < 4 && (
            <button className="btn btn-secondary" onClick={() => setStep((step - 1) as WizardStep)}>
              <ChevronLeft size={16} /> 上一步
            </button>
          )}
          <div className="footer-spacer" />
          {step < 3 && (
            <button className="btn btn-primary" disabled={!canNext()} onClick={() => setStep((step + 1) as WizardStep)}>
              下一步 <ChevronRight size={16} />
            </button>
          )}
          {step === 3 && (
            <button className="btn btn-primary" disabled={!canNext()} onClick={handleStartDistill}>
              开始蒸馏
            </button>
          )}
          {step === 4 && completedSkill && (
            <button className="btn btn-primary" onClick={handleSave}>
              保存角色
            </button>
          )}
          {step === 4 && !completedSkill && (
            <button className="btn btn-secondary" onClick={handleCancelDistill}>
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
