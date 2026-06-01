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

type StepStatus = 'OK' | 'ERROR' | 'SKIP'

interface ParsedOutput {
  steps: { name: string; status: StepStatus; detail: string }[]
  raw: string
  hasFinalOK: boolean
}

function parseScriptOutput(stdout: string): ParsedOutput {
  const raw = (stdout || '').trim()
  const steps: { name: string; status: StepStatus; detail: string }[] = []
  let hasFinalOK = false

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('STEP:')) {
      const rest = trimmed.slice(5)
      const colonIdx = rest.indexOf(':')
      if (colonIdx > 0) {
        const name = rest.slice(0, colonIdx).trim()
        const statusAndDetail = rest.slice(colonIdx + 1).trim()
        const spaceIdx = statusAndDetail.indexOf(' ')
        if (spaceIdx > 0) {
          const status = statusAndDetail.slice(0, spaceIdx).trim() as StepStatus
          const detail = statusAndDetail.slice(spaceIdx + 1).trim()
          steps.push({ name, status, detail })
        } else {
          const status = statusAndDetail as StepStatus
          steps.push({ name, status, detail: '' })
        }
      }
    } else if (trimmed === 'SEND_COMPLETE') {
      hasFinalOK = true
    }
  }

  return { steps, raw, hasFinalOK }
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

    const script = `Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
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
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public const uint WM_GETTEXT = 0x000D;
  public const uint WM_SETTEXT = 0x000C;
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
}
"@

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Name, [string]$Status, [string]$Detail = '')
  if ($Detail) {
    Write-Output "STEP:$Name`:$Status`:$Detail"
  } else {
    Write-Output "STEP:$Name`:$Status"
  }
}

function Activate-WeChat {
  $wechat = Get-Process -Name 'WeChat' -ErrorAction SilentlyContinue
  if (-not $wechat) {
    Write-Step 'ActivateWeChat' 'ERROR' 'WeChat process not found'
    return $false
  }

  $mainWindow = $wechat.MainWindowHandle
  if ($mainWindow -eq [IntPtr]::Zero) {
    Write-Step 'ActivateWeChat' 'ERROR' 'Window handle is zero (WeChat may be minimized to tray)'
    return $false
  }

  [Win32]::ShowWindow($mainWindow, [Win32]::SW_RESTORE)
  Start-Sleep -Milliseconds 300

  $currentFg = [Win32]::GetForegroundWindow()
  if ($currentFg -ne $mainWindow) {
    [Win32]::SetForegroundWindow($mainWindow) | Out-Null
    Start-Sleep -Milliseconds 500
  }

  $currentFg = [Win32]::GetForegroundWindow()
  if ($currentFg -ne $mainWindow) {
    Write-Step 'ActivateWeChat' 'WARNING' 'Window may not be in foreground, but continuing anyway'
  } else {
    Write-Step 'ActivateWeChat' 'OK' 'WeChat is now in foreground'
  }

  return $true
}

function Find-InputEdit {
  param([IntPtr]$WindowHandle)

  try {
    Add-Type @"
using System;
using System.Windows.Automation;
using System.Runtime.InteropServices;
public class UIAHelper {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

  public static IntPtr GetWindowHandle(long handleAsLong) {
    return new IntPtr(handleAsLong);
  }
}
"@ -ErrorAction SilentlyContinue

    $editHandle = [UIAHelper]::FindWindowEx($WindowHandle, [IntPtr]::Zero, 'Edit', '')
    if ($editHandle -eq [IntPtr]::Zero) {
      $editHandle = [UIAHelper]::FindWindowEx($WindowHandle, [IntPtr]::Zero, '', 'chat')
    }
    if ($editHandle -eq [IntPtr]::Zero) {
      $editHandle = [UIAHelper]::FindWindowEx($WindowHandle, [IntPtr]::Zero, 'RICHEDIT_WIDGET', '')
    }

    if ($editHandle -ne [IntPtr]::Zero) {
      Write-Step 'FindInputEdit' 'OK' "Found edit control with handle $editHandle"
      return $editHandle
    }

    Write-Step 'FindInputEdit' 'ERROR' 'Could not find input edit control'
    return [IntPtr]::Zero
  } catch {
    Write-Step 'FindInputEdit' 'ERROR' $_.Exception.Message
    return [IntPtr]::Zero
  }
}

function Get-EditText {
  param([IntPtr]$editHandle)

  if ($editHandle -eq [IntPtr]::Zero) {
    return ''
  }

  try {
    $bufSize = 8192
    $buf = New-Object System.Text.StringBuilder($bufSize)
    $len = [Win32]::SendMessage($editHandle, [Win32]::WM_GETTEXT, [IntPtr]($bufSize), $buf) | Select-Object -First 1
    if ($len -is [int]) {
      return $buf.ToString()
    } else {
      return $len.ToString()
    }
  } catch {
    return ''
  }
}

function Search-And-Navigate {
  param([string]$ContactName)

  Write-Step 'SearchContact' 'OK' 'Starting search'
  [System.Windows.Forms.SendKeys]::SendWait('^f')
  Start-Sleep -Milliseconds 400

  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 100

  try {
    [System.Windows.Forms.Clipboard]::SetText($ContactName) | Out-Null
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 800

    $clipboardAfter = ''
    try { $clipboardAfter = [System.Windows.Forms.Clipboard]::GetText() } catch {}

    [System.Windows.Forms.Clipboard]::Clear() | Out-Null
    Start-Sleep -Milliseconds 100
  } catch {
    Write-Step 'SearchContact' 'ERROR' "Failed to paste contact name: $($_.Exception.Message)"
    return $false
  }

  [System.Windows.Forms.SendKeys]::SendWait('{Enter}')
  Start-Sleep -Milliseconds 600

  [System.Windows.Forms.SendKeys]::SendWait('{Esc}')
  Start-Sleep -Milliseconds 300

  Write-Step 'SearchContact' 'OK' "Contact '$ContactName' searched and navigated"
  return $true
}

function Send-Text {
  param(
    [string]$Text,
    [IntPtr]$WindowHandle
  )

  $editHandle = Find-InputEdit -WindowHandle $WindowHandle

  $originalClipboard = ''
  try { $originalClipboard = [System.Windows.Forms.Clipboard]::GetText() } catch {}

  try {
    [System.Windows.Forms.Clipboard]::SetText($Text) | Out-Null
    Start-Sleep -Milliseconds 150

    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 300

    $textAfterPaste = Get-EditText -editHandle $editHandle
    if (-not $textAfterPaste -or $textAfterPaste.Length -eq 0) {
      Write-Step 'PasteText' 'ERROR' 'Pasted text not found in input field'
      return $false
    }

    Write-Step 'PasteText' 'OK' "Text pasted, length=$($textAfterPaste.Length)"
  } catch {
    Write-Step 'PasteText' 'ERROR' "Failed to paste text: $($_.Exception.Message)"
    return $false
  }

  [System.Windows.Forms.SendKeys]::SendWait('{Enter}')
  Start-Sleep -Milliseconds 100

  try {
    if ($originalClipboard) {
      [System.Windows.Forms.Clipboard]::SetText($originalClipboard) | Out-Null
    } else {
      [System.Windows.Forms.Clipboard]::Clear() | Out-Null
    }
  } catch {}

  Start-Sleep -Milliseconds 800

  $textAfterSend = Get-EditText -editHandle $editHandle
  if ($textAfterSend -and $textAfterSend.Length -gt 0) {
    Write-Step 'VerifySend' 'ERROR' "Input field still has text after send, message may not have been sent. Text: '$textAfterSend'"
    return $false
  }

  Write-Step 'VerifySend' 'OK' 'Input field is empty, message appears to be sent'
  return $true
}

$activated = Activate-WeChat
if (-not $activated) {
  exit 1
}

$wechat = Get-Process -Name 'WeChat' -ErrorAction SilentlyContinue
$mainWindow = $wechat.MainWindowHandle

Start-Sleep -Milliseconds 300

$searchResult = Search-And-Navigate -ContactName '${escapedName}'
if (-not $searchResult) {
  exit 1
}

Start-Sleep -Milliseconds 300

$sendResult = Send-Text -Text '${escapedMessage}' -WindowHandle $mainWindow
if (-not $sendResult) {
  exit 1
}

Start-Sleep -Milliseconds 300
Write-Output 'SEND_COMPLETE'
`

    await writeFile(scriptPath, '\uFEFF' + script, 'utf-8')
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
          lastError = '无法创建临时脚本文件'
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

        const parsed = parseScriptOutput(stdout || '')
        console.log(`[WeChatSender] === PowerShell 脚本执行完成 ===`)
        console.log(`[WeChatSender] stdout (原始): ${JSON.stringify(parsed.raw)}`)
        console.log(`[WeChatSender] stderr (原始): ${JSON.stringify(stderr || '')}`)
        console.log(`[WeChatSender] 解析到的步骤数: ${parsed.steps.length}`)
        for (const step of parsed.steps) {
          console.log(`[WeChatSender]   步骤: ${step.name} = ${step.status}, 详情: ${step.detail}`)
        }
        console.log(`[WeChatSender] hasFinalOK: ${parsed.hasFinalOK}`)
        console.log(`[WeChatSender] 尝试 ${attempt}/${this.maxRetries} 输出解析完成`)

        const errorSteps = parsed.steps.filter(s => s.status === 'ERROR')
        if (errorSteps.length > 0) {
          lastError = errorSteps.map(s => `${s.name}: ${s.detail}`).join('; ')
          console.warn(`[WeChatSender] 脚本步骤出错: ${lastError}`)
          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay))
            continue
          }
          return { success: false, error: lastError }
        }

        if (parsed.hasFinalOK) {
          return { success: true }
        }

        if (parsed.steps.length > 0 && errorSteps.length === 0) {
          return { success: true }
        }

        const stderrStr = (stderr || '').trim()
        lastError = stderrStr || parsed.raw || '脚本未输出有效结果'
        if (attempt < this.maxRetries) {
          console.log(`[WeChatSender] 发送异常 (尝试 ${attempt}/${this.maxRetries}): ${lastError}`)
          await new Promise(resolve => setTimeout(resolve, this.retryDelay))
          continue
        }
        return { success: false, error: lastError }
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
