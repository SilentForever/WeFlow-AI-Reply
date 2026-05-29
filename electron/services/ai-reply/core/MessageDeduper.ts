import type { WeChatMessage } from '../../../../src/types/ai-reply'

interface DedupEntry {
  contentHash: string
  processedAt: number
}

export class MessageDeduper {
  private processed: Map<string, DedupEntry> = new Map()
  private maxEntries: number
  private ttlMs: number

  constructor(maxEntries = 10000, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries
    this.ttlMs = ttlMs
  }

  isDuplicate(msgId: string): boolean {
    return this.processed.has(msgId)
  }

  markProcessed(msgId: string, contentHash?: string): void {
    this.processed.set(msgId, {
      contentHash: contentHash || '',
      processedAt: Date.now()
    })

    this.evict()
  }

  isSimilar(content: string, contactId: string, threshold = 0.9): boolean {
    const now = Date.now()
    for (const [, entry] of this.processed) {
      if (now - entry.processedAt > this.ttlMs) continue
      if (entry.contentHash && this.similarity(content, entry.contentHash) > threshold) {
        return true
      }
    }
    return false
  }

  clear(): void {
    this.processed.clear()
  }

  private evict(): void {
    if (this.processed.size <= this.maxEntries) return

    const now = Date.now()
    const entries = Array.from(this.processed.entries())
      .filter(([, entry]) => now - entry.processedAt < this.ttlMs)
      .sort((a, b) => a[1].processedAt - b[1].processedAt)

    this.processed.clear()
    const keep = entries.slice(-this.maxEntries)
    for (const [key, value] of keep) {
      this.processed.set(key, value)
    }
  }

  private similarity(a: string, b: string): number {
    if (a === b) return 1
    if (!a || !b) return 0

    const longer = a.length > b.length ? a : b
    const shorter = a.length > b.length ? b : a

    if (longer.length === 0) return 1

    const editDistance = this.levenshtein(longer, shorter)
    return (longer.length - editDistance) / longer.length
  }

  private levenshtein(a: string, b: string): number {
    const matrix: number[][] = []

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        }
      }
    }

    return matrix[b.length][a.length]
  }
}
