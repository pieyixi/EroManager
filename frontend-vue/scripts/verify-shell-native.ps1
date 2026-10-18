param(
  [Parameter(Mandatory)][string]$ExecutablePath,
  [Parameter(Mandatory)][string]$ReportDirectory
)
$ErrorActionPreference = 'Stop'
# 只接收本次隔离便携副本；预建空数据库阻止自动导入旧 AppData 资料。
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$appDirectory = Split-Path -Parent $executable
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (!$appDirectory.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $appDirectory) -notlike 'ark-structure-native-*' -or
    (Split-Path -Leaf $executable) -ne 'ero-manager.exe') { throw 'Only an isolated structure-test runtime is allowed' }
if (!(Test-Path -LiteralPath (Join-Path $appDirectory 'db\database.db'))) { throw 'Create an empty isolated db\database.db before launching' }
$null = New-Item -ItemType Directory -Path $ReportDirectory -Force
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StructureWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
}
'@
$null = [StructureWindow]::SetProcessDpiAwarenessContext([IntPtr](-4))
$start = [Diagnostics.ProcessStartInfo]::new($executable)
$start.UseShellExecute = $false
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$start.WorkingDirectory = $appDirectory
$start.Environment['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $appDirectory 'webview-profile'
$application = [Diagnostics.Process]::Start($start)
try {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $application.Refresh()
    if ($application.HasExited) { throw 'Isolated runtime exited during startup' }
    if ($application.MainWindowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 300
  }
  $window = $application.MainWindowHandle
  if ($window -eq [IntPtr]::Zero) { throw 'Isolated window did not appear' }
  $native = Get-CimInstance Win32_Process -Filter "ProcessId=$($application.Id)"
  if ($native.ExecutablePath -ne $executable) { throw 'Unexpected process path' }
  $null = [StructureWindow]::ShowWindow($window, 9)
  $null = [StructureWindow]::SetForegroundWindow($window)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($window)
  if ($root.Current.Name -ne '裏界箱庭') { throw 'Native product title was not updated' }
  function Find-Button([string]$name) {
    $condition = [System.Windows.Automation.AndCondition]::new(
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name),
      [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
    @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition) | Where-Object { !$_.Current.IsOffscreen }) | Select-Object -First 1
  }
  function Invoke-Button([string]$name) {
    $button = Find-Button $name
    if (!$button) { throw "Native button missing: $name" }
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 450
  }
  function Capture([string]$name) {
    $null = [StructureWindow]::SetForegroundWindow($window)
    Start-Sleep -Milliseconds 200
    $rect = [StructureWindow+Rect]::new()
    $null = [StructureWindow]::GetWindowRect($window, [ref]$rect)
    $bitmap = [Drawing.Bitmap]::new($rect.Right-$rect.Left, $rect.Bottom-$rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
      $bitmap.Save((Join-Path $ReportDirectory $name), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
  for ($attempt=0; $attempt -lt 40 -and !(Find-Button '下载'); $attempt++) { Start-Sleep -Milliseconds 300 }
  Invoke-Button '首页'
  Capture 'native-home.png'
  Invoke-Button '里番'
  Invoke-Button '下载'
  Invoke-Button '返回'
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))
  if (!@($edits | Where-Object { !$_.Current.IsOffscreen }).Count) { throw 'Media search did not return' }
  Invoke-Button '本子'
  Invoke-Button '下载'
  Invoke-Button '返回'
  Invoke-Button '设置'
  Invoke-Button '作品下载'
  Capture 'native-download.png'
  Invoke-Button '返回'
  if (!(Find-Button 'Cookie 设置')) { throw 'Settings return failed' }
  Invoke-Button '首页'
  Invoke-Button '最大化'
  if (![StructureWindow]::IsZoomed($window) -or !(Find-Button '还原')) { throw 'Maximize state/resize subscription failed' }
  Capture 'native-maximized.png'
  Invoke-Button '还原'
  if ([StructureWindow]::IsZoomed($window) -or !(Find-Button '最大化')) { throw 'Restore state failed' }
  Invoke-Button '最小化'
  if (![StructureWindow]::IsIconic($window)) { throw 'Minimize forwarding failed' }
  $null = [StructureWindow]::ShowWindow($window, 9)
  Start-Sleep -Milliseconds 400
  Invoke-Button '关闭'
  if (!$application.WaitForExit(5000)) { throw 'Close forwarding failed' }
  [pscustomobject]@{ Executable=$executable; Navigation=$true; WindowControls=$true; DataIsolated=$true; Screenshots=$ReportDirectory } | ConvertTo-Json
} finally {
  $application.Refresh()
  if (!$application.HasExited -and $application.Path -eq $executable) { Stop-Process -Id $application.Id }
  $application.Dispose()
}
