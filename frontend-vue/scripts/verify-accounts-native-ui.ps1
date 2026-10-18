param([Parameter(Mandatory)][string]$TestRoot)
$ErrorActionPreference='Stop'
$resolved=(Resolve-Path -LiteralPath $TestRoot).Path
if (!$resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolved -Leaf).StartsWith('ero-accounts-native-')) { throw 'Unexpected isolated test directory' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AccountQaWindow {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$foreground=[AccountQaWindow]::GetForegroundWindow()
$info=[Diagnostics.ProcessStartInfo]::new()
$info.FileName=Join-Path $resolved 'ero-manager.exe';$info.WorkingDirectory=$resolved;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$info.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER']=Join-Path $resolved 'db\webview-qa'
$info.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding'
$application=[Diagnostics.Process]::Start($info)
try {
 for($i=0;$i -lt 80;$i++) { $application.Refresh();if($application.HasExited){throw 'Native test app exited'};if($application.MainWindowHandle -ne [IntPtr]::Zero){break};Start-Sleep -Milliseconds 250 }
 $handle=$application.MainWindowHandle
 $null=[AccountQaWindow]::ShowWindow($handle,4)
 $null=[AccountQaWindow]::SetWindowPos($handle,[IntPtr]1,0,0,0,0,0x53)
 $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
 function Find-Element([string]$Name) { $root.FindFirst([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$Name)) }
 function Wait-Element([string]$Name) { for($i=0;$i -lt 120;$i++){ $element=Find-Element $Name;if($element){return $element};Start-Sleep -Milliseconds 250 };throw "Native account element missing: $Name" }
 function Invoke-Element([string]$Name) { $element=Wait-Element $Name;([Windows.Automation.InvokePattern]$element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke() }
 $pin=Wait-Element '四位 PIN'
 ([Windows.Automation.ValuePattern]$pin.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)).SetValue('9999')
 # 普通错误已改为只有轻晃，不再查找错误提示文字。
 Start-Sleep -Milliseconds 1200
 if(!(Find-Element '四位 PIN')) { throw 'Wrong PIN unexpectedly dismissed the privacy curtain' }
 $pin=Wait-Element '四位 PIN';([Windows.Automation.ValuePattern]$pin.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)).SetValue('1357')
 $null=Wait-Element '设置';Invoke-Element '设置';$null=Wait-Element '编辑账号'
 Invoke-Element '编辑账号';$null=Wait-Element '账号资料';$null=Wait-Element '0001'
 [pscustomobject]@{Status='PASS real Tauri PIN rejection/authentication, profile hydration, account ID';Root=$resolved;IsolatedWebView=$true}|ConvertTo-Json -Compress
} finally {
 # UIA 可能激活被测 WebView。仅在前台仍是本次测试窗口时归还原窗口，不覆盖用户主动切换。
 if([AccountQaWindow]::GetForegroundWindow() -eq $application.MainWindowHandle) { $null=[AccountQaWindow]::SetForegroundWindow($foreground) }
 if(!$application.HasExited){Stop-Process -Id $application.Id -Force}
}
