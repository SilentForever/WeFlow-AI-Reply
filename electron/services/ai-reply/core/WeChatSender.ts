import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'

const execAsync = promisify(exec)

export interface SendResult {
  success: boolean
  error?: string
}

export class WeChatSender {
  private enabled: boolean = false
  private maxRetries: number = 2
  private retryDelay: number = 1500

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  private async writeTempScript(contactName: string, message: string): Promise<string> {
    const tmpDir = join(tmpdir(), 'weflow-send')
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true })
    }
    const scriptPath = join(tmpDir, `send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ps1`)

    const escapedName = contactName.replace(/'/g, "''")
    const safeMessage = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const escapedMessage = safeMessage.replace(/'/g, "''")
    const hasNewlines = safeMessage.includes('\n')

    let sendMessageBlock: string
    if (hasNewlines) {
      const lines = safeMessage.split('\n')
      const lineStatements = lines.map((line, i) => {
        const escapedLine = line.replace(/'/g, "''")
        return `Send-UsingClipboard -Text '${escapedLine}'
Start-Sleep -Milliseconds 150`
      }).join('\n')
      sendMessageBlock = `
${lineStatements}
[System.Windows.Forms.SendKeys]::SendWait('{Enter}')`
    } else {
      sendMessageBlock = `
Send-UsingClipboard -Text '${escapedMessage}'
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{Enter}')`
    }

    const script = `Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

function Activate-WeChat {
  $wechat = Get-Process -Name 'WeChat' -ErrorAction SilentlyContinue
  if (-not $wechat) {
    Write-Output 'ERROR:WeChat not running'
    return $false
  }

  $mainWindow = $wechat.MainWindowHandle
  if ($mainWindow -eq [IntPtr]::Zero) {
    Write-Output 'ERROR:WeChat window not found'
    return $false
  }

  [Win32]::ShowWindow($mainWindow, 9)
  Start-Sleep -Milliseconds 500

  [Win32]::SetForegroundWindow($mainWindow)
  Start-Sleep -Milliseconds 500

  $currentForeground = [Win32]::GetForegroundWindow()
  if ($currentForeground -ne $mainWindow) {
    Write-Output 'WARNING:Window activation may have failed'
  }

  return $true
}

function Send-UsingClipboard {
  param(
    [string]$Text
  )

  $originalClipboard = $null
  try {
    $originalClipboard = [System.Windows.Forms.Clipboard]::GetText()
  } catch {}

  try {
    [System.Windows.Forms.Clipboard]::SetText($Text)
    Start-Sleep -Milliseconds 100

    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 200

    return $true
  }
  finally {
    Start-Sleep -Milliseconds 100
    if ($originalClipboard) {
      try {
        [System.Windows.Forms.Clipboard]::SetText($originalClipboard)
      } catch {}
    }
  }
}

function Search-And-Navigate {
  param(
    [string]$ContactName
  )

  [System.Windows.Forms.SendKeys]::SendWait('^f')
  Start-Sleep -Milliseconds 500

  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 100

  Send-UsingClipboard -Text $ContactName
  Start-Sleep -Milliseconds 800

  [System.Windows.Forms.SendKeys]::SendWait('{Enter}')
  Start-Sleep -Milliseconds 600

  [System.Windows.Forms.SendKeys]::SendWait('{Esc}')
  Start-Sleep -Milliseconds 300
}

$activated = Activate-WeChat
if (-not $activated) {
  exit 1
}

Start-Sleep -Milliseconds 300

Search-And-Navigate -ContactName '${escapedName}'

Start-Sleep -Milliseconds 300
${sendMessageBlock}

Start-Sleep -Milliseconds 300
Write-Output 'OK'
`

    await writeFile(scriptPath, script, 'utf-8')
    return scriptPath
  }

  async sendTextMessage(contactId: string, contactName: string, message: string, isGroup = false): Promise<SendResult> {
    if (!this.enabled) {
      return { success: false, error: '消息发送功能未启用' }
    }

    if (process.platform !== 'win32') {
      return { success: false, error: '消息发送功能仅支持 Windows 系统' }
    }

    if (!contactName) {
      return { success: false, error: '联系人名称为空，无法发送' }
    }

    if (!message || !message.trim()) {
      return { success: false, error: '消息内容为空，无法发送' }
    }

    let lastError = ''
    let finalMessage = message

    if (isGroup && contactName) {
      finalMessage = `@${contactName} ${message}`
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      let scriptPath = ''
      try {
        scriptPath = await this.writeTempScript(contactName, finalMessage)
        if (!scriptPath) {
          lastError = 'Failed to create temp script'
          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay))
            continue
          }
          return { success: false, error: lastError }
        }

        const { stdout, stderr } = await execAsync(
          `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
          { timeout: 30000, windowsHide: true }
        )

        const output = (stdout || '').trim()
        if (output === 'OK' || output.endsWith('OK')) {
          return { success: true }
        } else if (output.startsWith('ERROR:')) {
          lastError = output.substring(6)
          if (attempt < this.maxRetries) {
            console.log(`[WeChatSender] 发送失败 (尝试 ${attempt}/${this.maxRetries}): ${lastError}`)
            await new Promise(resolve => setTimeout(resolve, this.retryDelay))
            continue
          }
          return { success: false, error: lastError }
        } else if (output.includes('OK')) {
          return { success: true }
        } else {
          lastError = (stderr || '').trim() || output || 'Unknown error'
          if (lastError.includes('WARNING')) {
            return { success: true }
          }
          if (attempt < this.maxRetries) {
            console.log(`[WeChatSender] 发送异常 (尝试 ${attempt}/${this.maxRetries}): ${lastError}`)
            await new Promise(resolve => setTimeout(resolve, this.retryDelay))
            continue
          }
          return { success: false, error: lastError }
        }
      } catch (e: any) {
        lastError = e.message || 'Failed to send message'
        if (lastError.includes('timed out')) {
          lastError = '发送超时(30s)，微信可能未响应'
        }
        if (attempt < this.maxRetries) {
          console.log(`[WeChatSender] 发送异常 (尝试 ${attempt}/${this.maxRetries}): ${lastError}`)
          await new Promise(resolve => setTimeout(resolve, this.retryDelay))
          continue
        }
        return { success: false, error: lastError }
      } finally {
        if (scriptPath) {
          try { await unlink(scriptPath) } catch {}
        }
      }
    }

    return { success: false, error: lastError }
  }
}
