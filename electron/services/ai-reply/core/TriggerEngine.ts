import type { TriggerRules, WeChatMessage } from '../../../../src/types/ai-reply'

interface RateLimitEntry {
  timestamps: number[]
}

export class TriggerEngine {
  private rules: TriggerRules
  private rateLimitMap: Map<string, RateLimitEntry> = new Map()
  private selfNickname: string = ''

  constructor(rules: TriggerRules) {
    this.rules = rules
  }

  setSelfNickname(name: string): void {
    this.selfNickname = name
  }

  updateRules(rules: TriggerRules): void {
    this.rules = rules
  }

  getRules(): TriggerRules {
    return this.rules
  }

  shouldReply(message: WeChatMessage): { shouldReply: boolean; reason?: string } {
    if (!this.rules.enabled) {
      return { shouldReply: false, reason: '自动回复未启用' }
    }

    const contactCheck = this.checkContact(message)
    if (!contactCheck.passed) {
      return { shouldReply: false, reason: contactCheck.reason }
    }

    const keywordCheck = this.checkKeywords(message)
    if (!keywordCheck.passed) {
      return { shouldReply: false, reason: keywordCheck.reason }
    }

    const atCheck = this.checkAtTrigger(message)
    if (!atCheck.passed) {
      return { shouldReply: false, reason: atCheck.reason }
    }

    const timeCheck = this.checkTimeRules()
    if (!timeCheck.passed) {
      return { shouldReply: false, reason: timeCheck.reason }
    }

    const rateCheck = this.checkRateLimit(message)
    if (!rateCheck.passed) {
      return { shouldReply: false, reason: rateCheck.reason }
    }

    this.recordReply(message)

    return { shouldReply: true }
  }

  private checkContact(message: WeChatMessage): { passed: boolean; reason?: string } {
    switch (this.rules.listenMode) {
      case 'all':
        return { passed: true }
      case 'specific':
        if (this.rules.targetContacts.length === 0) {
          return { passed: false, reason: '未指定监听联系人' }
        }
        if (!this.rules.targetContacts.includes(message.contactId) &&
            !this.rules.targetContacts.includes(message.contactName)) {
          return { passed: false, reason: '不在监听列表中' }
        }
        return { passed: true }
      case 'whitelist':
        if (!this.rules.whitelist.includes(message.contactId) &&
            !this.rules.whitelist.includes(message.contactName)) {
          return { passed: false, reason: '不在白名单中' }
        }
        return { passed: true }
      case 'blacklist':
        if (this.rules.blacklist.includes(message.contactId) ||
            this.rules.blacklist.includes(message.contactName)) {
          return { passed: false, reason: '在黑名单中' }
        }
        return { passed: true }
      default:
        return { passed: false, reason: `未知监听模式: ${this.rules.listenMode}` }
    }
  }

  private checkKeywords(message: WeChatMessage): { passed: boolean; reason?: string } {
    if (this.rules.keywords.include.length > 0) {
      const hasKeyword = this.rules.keywords.include.some(kw =>
        message.content.includes(kw)
      )
      if (!hasKeyword) {
        return { passed: false, reason: '不包含触发关键词' }
      }
    }

    if (this.rules.keywords.exclude.some(kw => message.content.includes(kw))) {
      return { passed: false, reason: '包含排除关键词' }
    }

    if (this.rules.keywords.regex) {
      try {
        const regex = new RegExp(this.rules.keywords.regex)
        if (!regex.test(message.content)) {
          return { passed: false, reason: '不匹配正则规则' }
        }
      } catch {
        // invalid regex, skip
      }
    }

    return { passed: true }
  }

  private checkAtTrigger(message: WeChatMessage): { passed: boolean; reason?: string } {
    if (!message.isGroup) {
      return { passed: true }
    }

    if (this.rules.keywords.include.length > 0) {
      return { passed: true }
    }

    if (this.rules.triggerOnAt) {
      const content = message.content
      const atPatterns = ['@all', '@所有人', '@全体成员']
      const isAtAll = atPatterns.some(pattern => content.includes(pattern))

      let isAtMe = false
      if (this.selfNickname) {
        isAtMe = content.includes(`@${this.selfNickname}`)
      }
      if (!isAtMe) {
        isAtMe = content.includes('@我')
      }

      const atEveryone = this.rules.triggerOnAtAll && isAtAll

      if (!isAtMe && !atEveryone) {
        return { passed: false, reason: '群聊中未@，不触发回复' }
      }

      return { passed: true }
    }

    return { passed: true }
  }

  private checkTimeRules(): { passed: boolean; reason?: string } {
    if (!this.rules.timeRules.enabled) return { passed: true }

    const now = new Date()
    const hour = now.getHours()
    const [start, end] = this.rules.timeRules.allowedHours

    if (start <= end) {
      if (hour < start || hour >= end) {
        return { passed: false, reason: `当前时间不在允许范围内 (${start}:00-${end}:00)` }
      }
    } else {
      if (hour < start && hour >= end) {
        return { passed: false, reason: `当前时间不在允许范围内` }
      }
    }

    return { passed: true }
  }

  private checkRateLimit(message: WeChatMessage): { passed: boolean; reason?: string } {
    if (!this.rules.rateLimit.enabled) return { passed: true }

    const now = Date.now()
    const key = message.contactId
    let entry = this.rateLimitMap.get(key)

    if (!entry) {
      entry = { timestamps: [] }
      this.rateLimitMap.set(key, entry)
    }

    const windowMs = 60 * 1000
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs)

    if (entry.timestamps.length === 0) {
      this.rateLimitMap.delete(key)
    }

    if (this.rateLimitMap.size > 1000) {
      this.cleanupRateLimitMap(now)
    }

    const currentEntry = this.rateLimitMap.get(key)
    if (!currentEntry) return { passed: true }

    if (currentEntry.timestamps.length >= this.rules.rateLimit.maxRepliesPerMinute) {
      return { passed: false, reason: '超过频率限制' }
    }

    if (currentEntry.timestamps.length > 0) {
      const lastReply = currentEntry.timestamps[currentEntry.timestamps.length - 1]
      const elapsed = (now - lastReply) / 1000
      if (elapsed < this.rules.rateLimit.cooldownSeconds) {
        return { passed: false, reason: '冷却中' }
      }
    }

    return { passed: true }
  }

  private cleanupRateLimitMap(now: number): void {
    const windowMs = 60 * 1000
    for (const [key, entry] of this.rateLimitMap) {
      entry.timestamps = entry.timestamps.filter(t => now - t < windowMs)
      if (entry.timestamps.length === 0) {
        this.rateLimitMap.delete(key)
      }
    }
  }

  private recordReply(message: WeChatMessage): void {
    let entry = this.rateLimitMap.get(message.contactId)
    if (!entry) {
      entry = { timestamps: [] }
      this.rateLimitMap.set(message.contactId, entry)
    }
    entry.timestamps.push(Date.now())
  }
}
