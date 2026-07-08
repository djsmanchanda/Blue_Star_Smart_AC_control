Set shell = CreateObject("WScript.Shell")
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = """" & powershell & """ -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & appDir & "\launch-tray.ps1"""
shell.CurrentDirectory = appDir
shell.Run command, 0, False
