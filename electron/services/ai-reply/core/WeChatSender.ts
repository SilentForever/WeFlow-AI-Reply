import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface SendResult {
  success: boolean
  error?: string
}

export class WeChatSender {
  private enabled: boolean = false

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async sendTextMessage(contactId: string, contactName: string, message: string): Promise<SendResult> {
    if (!this.enabled) {
      return { success: false, error: '消息发送功能未启用' }
    }

    if (process.platform !== 'win32') {
      return { success: false, error: '消息发送功能仅支持 Windows 系统' }
    }

    try {
      const escapedMessage = message
        .replace(/\+/g, '{+}')
        .replace(/\^/g, '{^}')
        .replace(/%/g, '{%}')
        .replace(/~/g, '{~}')
        .replace(/\(/g, '{(}')
        .replace(/\)/g, '{)}')
        .replace(/{/g, '{{}')
        .replace(/}/g, '{}}')
        .replace(/'/g, "''")
        .replace(/\n/g, '{Enter}')
        .replace(/\r/g, '')

      const escapedName = contactName
        .replace(/\+/g, '{+}')
        .replace(/\^/g, '{^}')
        .replace(/%/g, '{%}')
        .replace(/~/g, '{~}')
        .replace(/\(/g, '{(}')
        .replace(/\)/g, '{)}')
        .replace(/{/g, '{{}')
        .replace(/}/g, '{}}')
        .replace(/'/g, "''")

      const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$wechat = Get-Process -Name 'WeChat' -ErrorAction SilentlyContinue
if (-not $wechat) {
  Write-Output 'ERROR:WeChat not running'
  exit 1
}

$mainWindow = $wechat.MainWindowHandle
if ($mainWindow -eq [IntPtr]::Zero) {
  Write-Output 'ERROR:WeChat window not found'
  exit 1
}

[Win32]::ShowWindow($mainWindow, 9)
Start-Sleep -Milliseconds 300
[Win32]::SetForegroundWindow($mainWindow)
Start-Sleep -Milliseconds 300

[System.Windows.Forms.SendKeys]::SendWait('^f')
Start-Sleep -Milliseconds 500

[System.Windows.Forms.SendKeys]::SendWait('${escapedName}')
Start-Sleep -Milliseconds 800

[System.Windows.Forms.SendKeys]::SendWait('{Enter}')
Start-Sleep -Milliseconds 500

[System.Windows.Forms.SendKeys]::SendWait('${escapedMessage}')
Start-Sleep -Milliseconds 200

[System.Windows.Forms.SendKeys]::SendWait('{Enter}')
Start-Sleep -Milliseconds 300

Write-Output 'OK'
`

      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { timeout: 15000, windowsHide: true }
      )

      const output = (stdout || '').trim()
      if (output === 'OK') {
        return { success: true }
      } else if (output.startsWith('ERROR:')) {
        return { success: false, error: output.substring(6) }
      } else {
        return { success: false, error: stderr?.trim() || 'Unknown error' }
      }
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to send message' }
    }
  }
}
