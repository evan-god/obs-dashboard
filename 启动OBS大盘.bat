@echo off
chcp 65001 >nul 2>&1
title OBS 监控大盘

cd /d "C:\Users\EDY\WorkBuddy\Claw"

echo 🚀 正在启动 OBS 监控大盘...
start "" "C:\Users\EDY\WorkBuddy\Claw\node_modules\electron\dist\electron.exe" "C:\Users\EDY\WorkBuddy\Claw"

exit
