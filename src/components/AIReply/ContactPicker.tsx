import { useState, useEffect, useRef } from 'react'
import { Search, X, Users, User } from 'lucide-react'
import './ContactPicker.scss'

interface ContactItem {
  id: string
  name: string
  avatar?: string
  isGroup: boolean
}

interface ContactPickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export default function ContactPicker({ selectedIds, onChange }: ContactPickerProps) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<ContactItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearch = async (value: string) => {
    setKeyword(value)
    if (!value.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const contacts = await window.electronAPI?.aiReply?.searchContacts(value.trim()) || []
      setResults(contacts.map((c: any) => ({
        id: c.id || c.contactId || c.username,
        name: c.name || c.displayName || c.nickname || c.contactName,
        avatar: c.avatar || c.avatarUrl,
        isGroup: c.isGroup || c.type === 'group' || false
      })))
    } catch {
      setResults([])
    }
    setSearching(false)
  }

  const toggleContact = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(i => i !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const removeSelected = (id: string) => {
    onChange(selectedIds.filter(i => i !== id))
  }

  const privateContacts = results.filter(c => !c.isGroup)
  const groupContacts = results.filter(c => c.isGroup)

  return (
    <div className="contact-picker" ref={containerRef}>
      {selectedIds.length > 0 && (
        <div className="selected-tags">
          {selectedIds.map(id => {
            const contact = results.find(c => c.id === id)
            return (
              <span key={id} className="selected-tag">
                {contact?.name || id}
                <button className="tag-remove" onClick={() => removeSelected(id)}>
                  <X size={12} />
                </button>
              </span>
            )
          })}
        </div>
      )}
      <div className="search-box">
        <Search size={16} className="search-icon" />
        <input
          value={keyword}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="搜索联系人..."
        />
      </div>
      {isOpen && keyword.trim() && (
        <div className="search-results">
          {searching && <div className="search-loading">搜索中...</div>}
          {!searching && results.length === 0 && (
            <div className="search-empty">未找到联系人</div>
          )}
          {!searching && privateContacts.length > 0 && (
            <div className="contact-group">
              <div className="group-label"><User size={14} /> 私聊</div>
              {privateContacts.map(c => (
                <div
                  key={c.id}
                  className={`contact-item ${selectedIds.includes(c.id) ? 'selected' : ''}`}
                  onClick={() => toggleContact(c.id)}
                >
                  <div className="contact-avatar">
                    {c.avatar ? <img src={c.avatar} alt="" /> : <span>{c.name[0]}</span>}
                  </div>
                  <span className="contact-name">{c.name}</span>
                  {selectedIds.includes(c.id) && <span className="check-mark">✓</span>}
                </div>
              ))}
            </div>
          )}
          {!searching && groupContacts.length > 0 && (
            <div className="contact-group">
              <div className="group-label"><Users size={14} /> 群聊</div>
              {groupContacts.map(c => (
                <div
                  key={c.id}
                  className={`contact-item ${selectedIds.includes(c.id) ? 'selected' : ''}`}
                  onClick={() => toggleContact(c.id)}
                >
                  <div className="contact-avatar">
                    {c.avatar ? <img src={c.avatar} alt="" /> : <span>{c.name[0]}</span>}
                  </div>
                  <span className="contact-name">{c.name}</span>
                  {selectedIds.includes(c.id) && <span className="check-mark">✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
