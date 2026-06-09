import { exec } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface SendResult {
  success: boolean
  error?: string
}

export interface WeChatSenderOptions {
  restoreClipboard?: boolean
  sendHotkey?: 'enter' | 'ctrl-enter'
}

type StepStatus = 'OK' | 'ERROR' | 'WARNING'

interface ParsedOutput {
  steps: { name: string; status: StepStatus; detail: string }[]
  raw: string
  hasFinalOK: boolean
}

interface TempSendBundle {
  scriptPath: string
  contactPath: string
  messagePath: string
}

function parseScriptOutput(stdout: string): ParsedOutput {
  const raw = (stdout || '').trim()
  const steps: ParsedOutput['steps'] = []
  let hasFinalOK = false

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed === 'SEND_COMPLETE') {
      hasFinalOK = true
      continue
    }

    if (!trimmed.startsWith('STEP:')) continue

    const parts = trimmed.slice(5).split(':')
    const name = parts.shift()?.trim() || 'Unknown'
    const status = (parts.shift()?.trim() || 'ERROR') as StepStatus
    const detail = parts.join(':').trim()
    steps.push({ name, status, detail })
  }

  return { steps, raw, hasFinalOK }
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

export class WeChatSender {
  private enabled = false
  private maxRetries = 2
  private retryDelay = 1500
  private options: Required<WeChatSenderOptions> = {
    restoreClipboard: true,
    sendHotkey: 'enter'
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setOptions(options: WeChatSenderOptions): void {
    this.options = {
      ...this.options,
      ...options,
      sendHotkey: options.sendHotkey === 'ctrl-enter' ? 'ctrl-enter' : 'enter',
      restoreClipboard: options.restoreClipboard !== false
    }
  }

  async checkAvailability(): Promise<SendResult> {
    if (!this.enabled) {
      return { success: false, error: 'Message sending is not enabled' }
    }

    if (process.platform !== 'win32') {
      return { success: false, error: 'Message sending currently supports Windows only' }
    }

    const script = String.raw`
$names = @('WeChat', 'Weixin', 'WeChatAppEx', 'WeixinAppEx')
foreach ($name in $names) {
  $proc = Get-Process -Name $name -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if ($proc) {
    Write-Output "OK:$($proc.ProcessName):$($proc.Id)"
    exit 0
  }
}
Write-Output 'ERROR:WeChat process with a visible main window was not found'
exit 1
`
    const encoded = Buffer.from(script, 'utf16le').toString('base64')

    try {
      const { stdout } = await execAsync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
        timeout: 7000,
        windowsHide: true,
        maxBuffer: 128 * 1024
      })
      const output = (stdout || '').trim()
      if (output.startsWith('OK:')) {
        return { success: true }
      }
      return { success: false, error: output || 'WeChat process with a visible main window was not found' }
    } catch (error: any) {
      const output = String(error?.stdout || '').trim()
      return {
        success: false,
        error: output.replace(/^ERROR:/, '') || error?.message || 'WeChat availability check failed'
      }
    }
  }

  async sendTextMessage(
    contactId: string,
    contactName: string,
    message: string,
    isGroup = false
  ): Promise<SendResult> {
    if (!this.enabled) {
      return { success: false, error: 'Message sending is not enabled' }
    }

    if (process.platform !== 'win32') {
      return { success: false, error: 'Message sending currently supports Windows only' }
    }

    const targetName = (contactName || contactId || '').trim()
    if (!targetName) {
      return { success: false, error: 'Contact name is empty, cannot open chat' }
    }

    const finalMessage = (message || '').trim()
    if (!finalMessage) {
      return { success: false, error: 'Message content is empty, cannot send' }
    }

    // Keep group replies as plain text. The sender name is not available here, and
    // prefixing "@group name" makes many group sends fail or address the wrong target.
    void isGroup

    let lastError = ''
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      let bundle: TempSendBundle | null = null

      try {
        bundle = await this.writeTempSendBundle(targetName, finalMessage)

        const command = [
          'powershell.exe',
          '-NoProfile',
          '-Sta',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          quoteArg(bundle.scriptPath),
          '-ContactFile',
          quoteArg(bundle.contactPath),
          '-MessageFile',
          quoteArg(bundle.messagePath),
          '-SendHotkey',
          quoteArg(this.options.sendHotkey),
          '-RestoreClipboard',
          quoteArg(this.options.restoreClipboard ? 'true' : 'false')
        ].join(' ')

        const { stdout, stderr } = await execAsync(command, {
          timeout: 45000,
          windowsHide: true,
          maxBuffer: 1024 * 1024
        })

        const parsed = parseScriptOutput(stdout || '')
        for (const step of parsed.steps) {
          console.log(`[WeChatSender] ${step.name}: ${step.status}${step.detail ? ` - ${step.detail}` : ''}`)
        }

        const errorSteps = parsed.steps.filter(step => step.status === 'ERROR')
        if (parsed.hasFinalOK && errorSteps.length === 0) {
          return { success: true }
        }

        lastError =
          errorSteps.map(step => `${step.name}: ${step.detail}`).join('; ') ||
          (stderr || '').trim() ||
          parsed.raw ||
          'PowerShell sender did not report completion'

        console.warn(`[WeChatSender] send attempt ${attempt}/${this.maxRetries} failed: ${lastError}`)
      } catch (error: any) {
        lastError = error?.killed
          ? 'Sending timed out after 45s; WeChat may not be responding'
          : error?.message || 'Failed to send message'
        console.warn(`[WeChatSender] send attempt ${attempt}/${this.maxRetries} threw: ${lastError}`)
      } finally {
        if (bundle) {
          await Promise.all([
            unlink(bundle.scriptPath).catch(() => {}),
            unlink(bundle.contactPath).catch(() => {}),
            unlink(bundle.messagePath).catch(() => {})
          ])
        }
      }

      if (attempt < this.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay))
      }
    }

    return { success: false, error: lastError }
  }

  private async writeTempSendBundle(contactName: string, message: string): Promise<TempSendBundle> {
    const tmpDir = join(tmpdir(), 'weflow-ai-reply-send')
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true })
    }

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const scriptPath = join(tmpDir, `send_${suffix}.ps1`)
    const contactPath = join(tmpDir, `contact_${suffix}.txt`)
    const messagePath = join(tmpDir, `message_${suffix}.txt`)

    await Promise.all([
      writeFile(scriptPath, `\uFEFF${SEND_SCRIPT}`, 'utf-8'),
      writeFile(contactPath, contactName, 'utf-8'),
      writeFile(messagePath, message, 'utf-8')
    ])

    return { scriptPath, contactPath, messagePath }
  }
}

const SEND_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$ContactFile,
  [Parameter(Mandatory=$true)][string]$MessageFile,
  [ValidateSet('enter','ctrl-enter')][string]$SendHotkey = 'enter',
  [ValidateSet('true','false')][string]$RestoreClipboard = 'true'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class NativeMethods {
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

function Write-Step {
  param([string]$Name, [string]$Status, [string]$Detail = '')
  if ($Detail) {
    Write-Output ('STEP:' + $Name + ':' + $Status + ':' + $Detail)
  } else {
    Write-Output ('STEP:' + $Name + ':' + $Status)
  }
}

function Read-Utf8File {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Set-ClipboardText {
  param([string]$Text)
  [System.Windows.Forms.Clipboard]::Clear() | Out-Null
  [System.Windows.Forms.Clipboard]::SetText($Text, [System.Windows.Forms.TextDataFormat]::UnicodeText) | Out-Null
}

function Invoke-SendHotkey {
  param([string]$Hotkey)
  if ($Hotkey -eq 'ctrl-enter') {
    [System.Windows.Forms.SendKeys]::SendWait('^{ENTER}')
  } else {
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
}

function Get-WeChatProcess {
  $names = @('WeChat', 'Weixin', 'WeChatAppEx', 'WeixinAppEx')

  foreach ($name in $names) {
    $proc = Get-Process -Name $name -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
      Sort-Object StartTime -Descending |
      Select-Object -First 1
    if ($proc) { return $proc }
  }

  return Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.MainWindowTitle -match 'WeChat|Weixin|微信')
    } |
    Select-Object -First 1
}

function Activate-WeChat {
  $wechat = Get-WeChatProcess
  if (-not $wechat) {
    Write-Step 'ActivateWeChat' 'ERROR' 'WeChat process with a visible main window was not found'
    return [IntPtr]::Zero
  }

  $handle = $wechat.MainWindowHandle
  [NativeMethods]::ShowWindow($handle, [NativeMethods]::SW_RESTORE) | Out-Null
  Start-Sleep -Milliseconds 200

  try {
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate($wechat.Id) | Out-Null
  } catch {}

  [NativeMethods]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 400

  $foreground = [NativeMethods]::GetForegroundWindow()
  if ($foreground -ne $handle) {
    Write-Step 'ActivateWeChat' 'WARNING' 'Window may not be foreground, continuing'
  } else {
    Write-Step 'ActivateWeChat' 'OK' 'WeChat is foreground'
  }

  return $handle
}

function Click-Point {
  param([int]$X, [int]$Y)
  [NativeMethods]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [NativeMethods]::mouse_event([NativeMethods]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [NativeMethods]::mouse_event([NativeMethods]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

function Get-BestInputElement {
  param([IntPtr]$WindowHandle)

  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    if (-not $root) { return $null }

    $editCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $documentCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Document
    )
    $condition = New-Object System.Windows.Automation.OrCondition($editCondition, $documentCondition)
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)

    $candidates = @()
    foreach ($element in $elements) {
      try {
        $rect = $element.Current.BoundingRectangle
        if ($element.Current.IsOffscreen) { continue }
        if (-not $element.Current.IsEnabled) { continue }
        if ($rect.Width -lt 80 -or $rect.Height -lt 20) { continue }
        $candidates += [PSCustomObject]@{ Element = $element; Rect = $rect; Score = ($rect.Y * 10 + $rect.Width) }
      } catch {}
    }

    if ($candidates.Count -eq 0) { return $null }
    return ($candidates | Sort-Object Score -Descending | Select-Object -First 1).Element
  } catch {
    return $null
  }
}

function Get-ElementText {
  param($Element)

  if (-not $Element) { return '' }

  try {
    $valuePattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      return $valuePattern.Current.Value
    }
  } catch {}

  try {
    $textPattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      return $textPattern.DocumentRange.GetText(-1)
    }
  } catch {}

  return ''
}

function Focus-Input {
  param([IntPtr]$WindowHandle)

  $element = Get-BestInputElement -WindowHandle $WindowHandle
  if ($element) {
    try { $element.SetFocus() | Out-Null } catch {}
    try {
      $rect = $element.Current.BoundingRectangle
      $x = [int]($rect.X + [Math]::Max(20, [Math]::Min($rect.Width / 2, 160)))
      $y = [int]($rect.Y + $rect.Height / 2)
      Click-Point -X $x -Y $y
      Write-Step 'FocusInput' 'OK' "Focused input via UIAutomation"
      return $element
    } catch {}
  }

  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    $rect = $root.Current.BoundingRectangle
    $x = [int]($rect.X + $rect.Width * 0.62)
    $y = [int]($rect.Y + $rect.Height - 95)
    Click-Point -X $x -Y $y
    Write-Step 'FocusInput' 'WARNING' 'Clicked estimated input area'
  } catch {
    Write-Step 'FocusInput' 'ERROR' $_.Exception.Message
    return $null
  }

  return Get-BestInputElement -WindowHandle $WindowHandle
}

function Search-And-Navigate {
  param([string]$ContactName)

  try {
    Set-ClipboardText -Text $ContactName
    [System.Windows.Forms.SendKeys]::SendWait('^f')
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 900
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 1000
    Write-Step 'SearchContact' 'OK' "Opened chat for '$ContactName'"
    return $true
  } catch {
    Write-Step 'SearchContact' 'ERROR' $_.Exception.Message
    return $false
  }
}

function Send-Text {
  param([string]$Text, [IntPtr]$WindowHandle, [string]$Hotkey)

  $inputElement = Focus-Input -WindowHandle $WindowHandle
  if (-not $inputElement) {
    Write-Step 'FindInput' 'ERROR' 'Could not focus chat input'
    return $false
  }

  try {
    Set-ClipboardText -Text $Text
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 350
    Write-Step 'PasteText' 'OK' "Pasted text, length=$($Text.Length)"
  } catch {
    Write-Step 'PasteText' 'ERROR' $_.Exception.Message
    return $false
  }

  $beforeSend = Get-ElementText -Element $inputElement

  try {
    Invoke-SendHotkey -Hotkey $Hotkey
    Start-Sleep -Milliseconds 900
  } catch {
    Write-Step 'SendEnter' 'ERROR' $_.Exception.Message
    return $false
  }

  $afterEnter = Get-ElementText -Element $inputElement
  if ($afterEnter -and $beforeSend -and $afterEnter.Trim().Length -gt 0) {
    try {
      $fallbackHotkey = if ($Hotkey -eq 'ctrl-enter') { 'enter' } else { 'ctrl-enter' }
      Invoke-SendHotkey -Hotkey $fallbackHotkey
      Start-Sleep -Milliseconds 800
      Write-Step 'SendFallback' 'WARNING' "Input still had text after $Hotkey, tried $fallbackHotkey"
    } catch {}
  }

  $afterFallback = Get-ElementText -Element $inputElement
  if ($beforeSend -and $afterFallback -and $afterFallback.Trim().Length -gt 0) {
    Write-Step 'VerifySent' 'ERROR' 'Input still contains text after send hotkeys'
    return $false
  }

  if (-not $beforeSend) {
    Write-Step 'VerifySent' 'WARNING' 'Input text could not be read; send keys were submitted'
  } else {
    Write-Step 'VerifySent' 'OK' 'Input was cleared after sending'
  }

  Write-Step 'SendMessage' 'OK' 'Send keys submitted'
  return $true
}

$originalClipboard = ''
$hadClipboard = $false
$shouldRestoreClipboard = $RestoreClipboard -ne 'false'

try {
  $ContactName = (Read-Utf8File -Path $ContactFile).Trim()
  $Text = Read-Utf8File -Path $MessageFile

  if (-not $ContactName) {
    Write-Step 'Validate' 'ERROR' 'Contact name is empty'
    exit 1
  }
  if (-not $Text -or $Text.Trim().Length -eq 0) {
    Write-Step 'Validate' 'ERROR' 'Message text is empty'
    exit 1
  }

  if ($shouldRestoreClipboard) {
    try {
      $originalClipboard = [System.Windows.Forms.Clipboard]::GetText()
      $hadClipboard = $true
    } catch {}
  }

  $mainWindow = Activate-WeChat
  if ($mainWindow -eq [IntPtr]::Zero) { exit 1 }

  if (-not (Search-And-Navigate -ContactName $ContactName)) { exit 1 }

  $mainWindow = Activate-WeChat
  if ($mainWindow -eq [IntPtr]::Zero) { exit 1 }

  if (-not (Send-Text -Text $Text -WindowHandle $mainWindow -Hotkey $SendHotkey)) { exit 1 }

  Write-Output 'SEND_COMPLETE'
} finally {
  if ($shouldRestoreClipboard) {
    try {
      if ($hadClipboard) {
        Set-ClipboardText -Text $originalClipboard
      } else {
        [System.Windows.Forms.Clipboard]::Clear() | Out-Null
      }
    } catch {}
  }
}
`
