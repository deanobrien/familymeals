Windows PowerShell 5.1 has no && or ||; chain with ; and check $LASTEXITCODE.

Docs and scripts for this repo assume PowerShell 5.1 or pwsh. Use `cmd1; if ($?) { cmd2 }`. Native-exe stderr via 2>&1 becomes ErrorRecords in 5.1. Quote paths with spaces. `Compress-Archive` writes backslash entry names that break on Linux: the package script uses tar.exe.
