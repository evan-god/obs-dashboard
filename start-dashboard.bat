@echo off
chcp 65001 >nul
title OBS 监控大盘 (含远程日志) v1.5.2

setlocal
set "NODE=C:\Users\EDY\.workbuddy\binaries\node\versions\22.22.2\node.exe"
set "ROOT=%~dp0"

:: 自适应路径：如果当前目录有 exe 就用当前目录，否则用 dist\win-unpacked
if exist "%ROOT%obs-dashboard.exe" (
  set "DIST=%ROOT%"
  set "LOGSRV=%ROOT%log-server.js"
) else (
  set "DIST=%ROOT%dist\win-unpacked"
  set "LOGSRV=%ROOT%log-server.js"
)

echo.
echo ═══ OBS 监控大盘 v1.5.2 ═══
echo.

:: 检查 Node 是否存在
if not exist "%NODE%" (
  echo [ERROR] Node.js 未找到: %NODE%
  echo         请修改本脚本中的 NODE 路径
  pause
  exit /b 1
)

:: 检查 log-server.js 是否存在
if not exist "%LOGSRV%" (
  echo [ERROR] log-server.js 未找到: %LOGSRV%
  pause
  exit /b 1
)

:: 启动日志服务（端口 8393）
echo [1/2] 启动远程日志服务 ...
start "" /B "%NODE%" "%LOGSRV%" > "%ROOT%logsrv.log" 2>&1
timeout /t 2 /nobreak >nul

curl -s http://127.0.0.1:8393/credentials >nul 2>&1
if %errorlevel% neq 0 (
  echo        ! 日志服务启动中，请稍候...
  timeout /t 3 /nobreak >nul
) else (
  echo        ^>^> 日志服务已启动 (127.0.0.1:8393)
)

:: 启动监控大盘
echo [2/2] 启动监控大盘 ...
start "" "%DIST%\obs-dashboard.exe"
echo        ^>^> 监控大盘已启动

echo.
echo ═══ 全部启动完成 ═══
echo.
echo 提示：请勿直接关闭本窗口，关闭后日志服务将停止。
echo       最小化本窗口即可。
