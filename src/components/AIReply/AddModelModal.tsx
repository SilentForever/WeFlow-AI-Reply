import { useState } from 'react'
import { X } from 'lucide-react'
import { useAIReplyStore } from '../../stores/aiReplyStore'
import type { ModelConfig, ModelType, OllamaConfig, OpenAICompatibleConfig } from '../../types/ai-reply'
import ModelSelector from './ModelSelector'
import './AddModelModal.scss'

interface AddModelModalProps {
  open: boolean
  onClose: () => void
}

export default function AddModelModal({ open, onClose }: AddModelModalProps) {
  const store = useAIReplyStore()
  const [type, setType] = useState<ModelType>('ollama')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-r1:7b')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    if (!name.trim() || !model.trim()) return
    setSubmitting(true)
    try {
      let config: any
      if (type === 'ollama') {
        config = { baseUrl, model, temperature, maxTokens }
      } else {
        config = { apiKey, baseUrl, model, temperature, maxTokens }
      }

      const modelConfig: ModelConfig = {
        id: `${type}-${Date.now()}`,
        name: name.trim(),
        type,
        enabled: true,
        config
      }

      await store.addModel(modelConfig)

      if (!store.activeModelId) {
        await store.setActiveModel(modelConfig.id)
      }

      onClose()
      setName('')
      setApiKey('')
      setModel('deepseek-r1:7b')
      setTemperature(0.7)
      setMaxTokens(2048)
    } finally {
      setSubmitting(false)
    }
  }

  const handleTypeChange = (t: ModelType) => {
    setType(t)
    if (t === 'ollama') setBaseUrl('http://localhost:11434')
    else if (t === 'openai') setBaseUrl('https://api.openai.com/v1')
    else if (t === 'claude') setBaseUrl('https://api.anthropic.com/v1')
    else if (t === 'gemini') setBaseUrl('https://generativelanguage.googleapis.com/v1beta')
    else setBaseUrl('')
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const canSubmit = name.trim() && model.trim() && !submitting

  return (
    <div className="add-model-overlay" onClick={handleOverlayClick}>
      <div className="add-model-modal">
        <div className="modal-header">
          <h3>添加模型</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>模型类型</label>
            <select value={type} onChange={e => handleTypeChange(e.target.value as ModelType)}>
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
            <ModelSelector
              type={type}
              baseUrl={baseUrl}
              apiKey={apiKey}
              value={model}
              onChange={setModel}
            />
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
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
