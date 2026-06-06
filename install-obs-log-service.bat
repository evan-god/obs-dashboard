@echo off
chcp 65001 >nul
title OBS 日志服务 — 一键部署

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   OBS 日志服务 v1.0 — 一键部署          ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  本脚本将：
echo    1. 安装 obs-log-service.js 到本机
echo    2. 创建开机自启任务
echo    3. 立即启动服务（端口 8393）
echo.
echo  部署后，每台 OBS 主机自动提供日志查看服务
echo  监控大盘可直连 http://主机IP:8393 获取日志
echo.

:: ── 1. 查找 Node.js ──────────────────────
echo  [1/5] 检测 Node.js...

set "NODE_PATH="

:: 优先使用 PATH 中的 node
where node >nul 2>&1
if %errorlevel%==0 (
    for /f "delims=" %%i in ('where node') do set "NODE_PATH=%%i"
    goto :found_node
)

:: 常见位置
for %%d in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\nodejs\node.exe"
    "%APPDATA%\npm\node.exe"
    "C:\Program Files\nodejs\node.exe"
) do (
    if exist %%d (
        set "NODE_PATH=%%d"
        goto :found_node
    )
)

echo  ❌ 未找到 Node.js！请先安装 Node.js
echo     下载地址: https://nodejs.org/
pause
exit /b 1

:found_node
echo  ✓ Node.js: %NODE_PATH%

:: ── 2. 检查防火墙 ──────────────────────
echo.
echo  [2/5] 配置防火墙 (端口 8393)...

netsh advfirewall firewall show rule name="OBS Log Service (8393)" >nul 2>&1
if %errorlevel%==0 (
    echo  ✓ 防火墙规则已存在
) else (
    netsh advfirewall firewall add rule name="OBS Log Service (8393)" dir=in action=allow protocol=TCP localport=8393 >nul 2>&1
    if %errorlevel%==0 (
        echo  ✓ 防火墙规则已添加
    ) else (
        echo  ⚠ 防火墙添加失败（如非管理员，请手动添加）
    )
)

:: ── 3. 复制服务文件 ──────────────────────
echo.
echo  [3/5] 安装服务文件...

set "INSTALL_DIR=%APPDATA%\obs-log-service"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

set "SERVICE_FILE=%INSTALL_DIR%\obs-log-service.js"
copy /Y "%~dp0obs-log-service.js" "%SERVICE_FILE%" >nul 2>&1
if %errorlevel%==0 (
    echo  ✓ 已安装到: %INSTALL_DIR%
) else (
    echo  ❌ 复制失败，请检查权限
    pause
    exit /b 1
)

:: ── 4. 创建开机自启 ──────────────────────
echo.
echo  [4/5] 配置开机自启...

:: 使用 Startup 文件夹（最兼容，不需要管理员权限）
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_VBS=%STARTUP_DIR%\obs-log-service.vbs"

:: 创建 VBS 脚本（无窗口启动）
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run """%NODE_PATH%"" ""%SERVICE_FILE%""", 0, False
) > "%STARTUP_VBS%"

if exist "%STARTUP_VBS%" (
    echo  ✓ 已创建开机自启: %STARTUP_VBS%
) else (
    echo  ⚠ 开机自启创建失败，服务不会自动运行
)

:: ── 5. 立即启动服务 ──────────────────────
echo.
echo  [5/5] 启动服务...

:: 检查端口是否已占用
netstat -ano 2>nul | findstr ":8393 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo  ⚠ 端口 8393 已被占用（可能已在运行）
    echo.
    echo  ╔══════════════════════════════════════════╗
    echo  ║  ✓ 部署完成！                            ║
    echo  ╚══════════════════════════════════════════╝
    echo.
    pause
    exit /b 0
)

:: 后台启动 Node 服务
start "" /B "%NODE_PATH%" "%SERVICE_FILE%"

:: 等 2 秒验证
ping 127.0.0.1 -n 2 >nul
netstat -ano 2>nul | findstr ":8393 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo  ✓ 服务已启动
) else (
    echo  ⚠ 服务可能未成功启动，请检查日志
)

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  ✓ 部署完成！                            ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  验证服务:
for /f "tokens=1-2 delims=:" %%a in ('curl -s http://127.0.0.1:8393/status 2^>nul ^| findstr /i "ok"') do (
    echo    curl http://127.0.0.1:8393/status
)

:: 获取本机 IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" 2^>nul') do (
    for /f "tokens=*" %%b in ("%%a") do (
        set "LAN_IP=%%b"
    )
)
if defined LAN_IP (
    echo.
    echo  仪表盘可通过此地址访问日志:
    echo    http://%LAN_IP: =%:8393/logs
)

echo.
echo  如需重新部署或更新: 再次运行本脚本即可
pause
