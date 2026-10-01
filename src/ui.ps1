param(
  [ValidateSet('setup', 'tray')][string]$Mode,
  [string]$ConfigPath,
  [string]$ExePath,
  [int]$ParentPid = 0,
  [int]$Port = 0,
  [string]$TestApplicationId = $env:CODEX_PRESENCE_TEST_APPLICATION_ID
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Show-Settings {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Coding Agents Discord Presence - Settings'
  $form.ClientSize = New-Object System.Drawing.Size(440, 360)
  $form.StartPosition = 'CenterScreen'
  $form.TopMost = $true
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

  $intro = New-Object System.Windows.Forms.Label
  $intro.Text = 'Share your Codex and Claude Code activity on Discord. Paste your Discord Application ID below.'
  $intro.Location = New-Object System.Drawing.Point(18, 16)
  $intro.Size = New-Object System.Drawing.Size(400, 42)
  $form.Controls.Add($intro)

  $link = New-Object System.Windows.Forms.LinkLabel
  $link.Text = 'Open Discord Developer Portal'
  $link.Location = New-Object System.Drawing.Point(18, 62)
  $link.AutoSize = $true
  $link.Add_LinkClicked({ Start-Process 'https://discord.com/developers/applications' })
  $form.Controls.Add($link)

  $label = New-Object System.Windows.Forms.Label
  $label.Text = 'Discord Application ID'
  $label.Location = New-Object System.Drawing.Point(18, 96)
  $label.AutoSize = $true
  $form.Controls.Add($label)

  $idBox = New-Object System.Windows.Forms.TextBox
  $idBox.Location = New-Object System.Drawing.Point(18, 118)
  $idBox.Size = New-Object System.Drawing.Size(400, 24)
  $form.Controls.Add($idBox)

  $visibilityLabel = New-Object System.Windows.Forms.Label
  $visibilityLabel.Text = 'When to show the activity'
  $visibilityLabel.Location = New-Object System.Drawing.Point(18, 154)
  $visibilityLabel.AutoSize = $true
  $form.Controls.Add($visibilityLabel)
  $visibility = New-Object System.Windows.Forms.ComboBox
  $visibility.Location = New-Object System.Drawing.Point(18, 176)
  $visibility.Size = New-Object System.Drawing.Size(400, 24)
  $visibility.DropDownStyle = 'DropDownList'
  [void]$visibility.Items.Add('Always while this app is open')
  [void]$visibility.Items.Add('Only while a task is running')
  $visibility.SelectedIndex = 0
  $form.Controls.Add($visibility)

  $codex = New-Object System.Windows.Forms.CheckBox
  $codex.Text = 'Codex App + CLI'
  $codex.Location = New-Object System.Drawing.Point(18, 218)
  $codex.AutoSize = $true
  $codex.Checked = $true
  $form.Controls.Add($codex)
  $claude = New-Object System.Windows.Forms.CheckBox
  $claude.Text = 'Claude Code (installs local hooks)'
  $claude.Location = New-Object System.Drawing.Point(152, 218)
  $claude.AutoSize = $true
  $claude.Checked = $true
  $form.Controls.Add($claude)
  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = 'Shows model, activity, tokens, estimated API cost and task time. Idle shows 0m. Restart Claude Code after enabling hooks.'
  $hint.Location = New-Object System.Drawing.Point(18, 246)
  $hint.Size = New-Object System.Drawing.Size(400, 36)
  $form.Controls.Add($hint)

  $startup = New-Object System.Windows.Forms.CheckBox
  $startup.Text = 'Start with Windows'
  $startup.Location = New-Object System.Drawing.Point(18, 284)
  $startup.AutoSize = $true
  $startup.Checked = $true
  $form.Controls.Add($startup)

  $existing = @{}
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $saved = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
      foreach ($property in $saved.PSObject.Properties) { $existing[$property.Name] = $property.Value }
      $idBox.Text = [string]$existing['discordApplicationId']
      $visibility.SelectedIndex = if ($existing['visibilityMode'] -eq 'active') { 1 } else { 0 }
      $codex.Checked = $existing['enableCodex'] -ne $false
      $claude.Checked = $existing['enableClaude'] -ne $false
    } catch { }
  }
  if ($idBox.Text) {
    $startup.Checked = [bool](Get-ItemProperty -Path $runKey -Name 'CodexDiscordPresence' -ErrorAction SilentlyContinue)
  }

  $save = New-Object System.Windows.Forms.Button
  $save.Text = 'Save and start'
  $save.Location = New-Object System.Drawing.Point(278, 318)
  $save.Size = New-Object System.Drawing.Size(140, 30)
  $save.Add_Click({
    $id = $idBox.Text.Trim()
    if ($id -notmatch '^\d{17,20}$') {
      [System.Windows.Forms.MessageBox]::Show('Enter the 17–20 digit Application ID from the Discord Developer Portal.', 'Invalid Application ID', 'OK', 'Warning') | Out-Null
      return
    }
    try {
      if (-not $codex.Checked -and -not $claude.Checked) { throw 'Enable Codex or Claude Code.' }
      $existing['discordApplicationId'] = $id
      $existing['visibilityMode'] = if ($visibility.SelectedIndex -eq 1) { 'active' } else { 'always' }
      $existing['enableCodex'] = $codex.Checked
      $existing['enableClaude'] = $claude.Checked
      $folder = Split-Path $ConfigPath -Parent
      New-Item -ItemType Directory -Path $folder -Force | Out-Null
      $json = $existing | ConvertTo-Json -Depth 10
      [System.IO.File]::WriteAllText($ConfigPath, $json, [System.Text.UTF8Encoding]::new($false))
      if (-not $TestApplicationId) {
        if ($startup.Checked) {
          New-ItemProperty -Path $runKey -Name 'CodexDiscordPresence' -Value ('"' + $ExePath + '"') -PropertyType String -Force | Out-Null
        } else {
          Remove-ItemProperty -Path $runKey -Name 'CodexDiscordPresence' -ErrorAction SilentlyContinue
        }
      }
      $form.DialogResult = 'OK'
      $form.Close()
    } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Could not save settings', 'OK', 'Error') | Out-Null
    }
  })
  $form.Controls.Add($save)
  $form.AcceptButton = $save

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancel'
  $cancel.Location = New-Object System.Drawing.Point(188, 318)
  $cancel.Size = New-Object System.Drawing.Size(80, 30)
  $cancel.DialogResult = 'Cancel'
  $form.Controls.Add($cancel)
  $form.CancelButton = $cancel

  if ($TestApplicationId) {
    $form.Add_Shown({
      if ($env:CODEX_PRESENCE_TEST_SCREENSHOT_PATH) {
        $bitmap = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
        $form.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
        $bitmap.Save($env:CODEX_PRESENCE_TEST_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
      }
      $idBox.Text = $TestApplicationId
      $startup.Checked = $false
      $save.PerformClick()
    })
  }
  $result = $form.ShowDialog()
  $form.Dispose()
  return $result -eq 'OK'
}

if ($Mode -eq 'setup') {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SetupConsole {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
}
'@
  $console = [SetupConsole]::GetConsoleWindow()
  if ($console -ne [IntPtr]::Zero) { [SetupConsole]::ShowWindow($console, 0) | Out-Null }
  if (Show-Settings) { exit 0 }
  exit 1
}

$context = New-Object System.Windows.Forms.ApplicationContext
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem('Waiting for coding agent task')
$statusItem.Enabled = $false
[void]$menu.Items.Add($statusItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$settingsItem = New-Object System.Windows.Forms.ToolStripMenuItem('Settings...')
$settingsItem.Add_Click({ [void](Show-Settings) })
[void]$menu.Items.Add($settingsItem)
$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem('Quit')
$quitItem.Add_Click({
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', $Port)
    $stream = $client.GetStream()
    $data = [System.Text.Encoding]::UTF8.GetBytes('quit')
    $stream.Write($data, 0, $data.Length)
    $client.Dispose()
  } catch { }
  $context.ExitThread()
})
[void]$menu.Items.Add($quitItem)

$icon = [System.Drawing.SystemIcons]::Application
$loadedIcon = $null
try {
  $iconPath = Join-Path (Split-Path $ConfigPath -Parent) 'codex.ico'
  if (Test-Path -LiteralPath $iconPath) {
    $loadedIcon = [System.Drawing.Icon]::new($iconPath)
    $icon = $loadedIcon
  }
} catch { }
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'Coding Agents Discord Presence'
$tray.ContextMenuStrip = $menu
$tray.Visible = $true
$tray.Add_DoubleClick({ [void](Show-Settings) })

$statusPath = Join-Path (Split-Path $ConfigPath -Parent) 'status.json'
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { $context.ExitThread(); return }
  try {
    if (Test-Path -LiteralPath $statusPath) {
      $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
      $message = [string]$status.message
      if ($message) {
        $statusItem.Text = $message
        $tray.Text = if ($message.Length -gt 63) { $message.Substring(0, 60) + '...' } else { $message }
      }
    }
  } catch { }
})
$timer.Start()
try { [System.Windows.Forms.Application]::Run($context) }
finally {
  $timer.Stop()
  $timer.Dispose()
  $tray.Visible = $false
  $tray.Dispose()
  if ($loadedIcon) { $loadedIcon.Dispose() }
  $menu.Dispose()
  $context.Dispose()
}
