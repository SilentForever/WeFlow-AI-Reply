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
  private maxRetries: number = 3
  private retryDelay: number = 1000

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
    const escapedMessage = message.replace(/'/g, "''")

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
  Start-Sleep -Milliseconds 400

  $prevForeground = [Win32]::GetForegroundWindow()
  [Win32]::SetForegroundWindow($mainWindow)
  Start-Sleep -Milliseconds 400

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

$activated = Activate-WeChat
if (-not $activated) {
  exit 1
}

Start-Sleep -Milliseconds 200

[System.Windows.Forms.SendKeys]::SendWait('^f')
Start-Sleep -Milliseconds 400

Send-UsingClipboard -Text '${escapedName}'
Start-Sleep -Milliseconds 600

[System.Windows.Forms.SendKeys]::SendWait('{Enter}')
Start-Sleep -Milliseconds 400

Send-UsingClipboard -Text '${escapedMessage}'
Start-Sleep -Milliseconds 300

[System.Windows.Forms.SendKeys]::SendWait('{Enter}')
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
          { timeout: 20000, windowsHide: true }
        )

        const output = (stdout || '').trim()
        if (output === 'OK') {
          return { success: true }
        } else if (output.startsWith('ERROR:')) {
          lastError = output.substring(6)
          if (attempt < this.maxRetries) {
            console.log(`[WeChatSender] 发送失败 (尝试 ${attempt}/${this.maxRetries}): ${lastError}，${this.retryDelay}ms 后重试...`)
            await new Promise(resolve => setTimeout(resolve, this.retryDelay))
            continue
          }
          return { success: false, error: lastError }
        } else if (output.includes('OK')) {
          return { success: true }
        } else {
          lastError = stderr?.trim() || output || 'Unknown error'
          if (attempt < this.maxRetries) {
            console.log(`[WeChatSender] 发送异常 (尝试 ${attempt}/${this.maxRetries}): ${lastError}，${this.retryDelay}ms 后重试...`)
            await new Promise(resolve => setTimeout(resolve, this.retryDelay))
            continue
          }
          return { success: false, error: lastError }
        }
      } catch (e: any) {
        lastError = e.message || 'Failed to send message'
        if (attempt < this.maxRetries) {
          console.log(`[WeChatSender] 发送异常 (尝试 ${attempt}/${this.maxRetries}): ${lastError}，${this.retryDelay}ms 后重试...`)
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
