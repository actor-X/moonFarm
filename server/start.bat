@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ============================================================
rem  MoonFarm 一键启动
rem    1. 先关掉本机已在运行的 moon.exe / node serve.js
rem    2. 启动静态文件服务(网页客户端) http://127.0.0.1:8080/
rem    3. 前台启动游戏服务, 退出时自动关掉静态服务
rem  提示: 若按 Ctrl+C 强杀, 静态服务会残留, 再跑一次本脚本即可清掉
rem ============================================================

rem 系统命令一律用绝对路径: 从 Git Bash 启动时 PATH 会优先命中 git 自带的
rem timeout.exe 等程序(参数不兼容), 这里显式写全路径避免踩坑.
set "SYS=%SystemRoot%\System32"
set "PS=%SYS%\WindowsPowerShell\v1.0\powershell.exe"
set "ROOT=%~dp0.."
set "MOON=..\bin\moon.exe"
set "WEBPORT=8080"

echo ============================================================
echo  MoonFarm 启动
echo    游戏服务 : TCP 9001 / WebSocket 9002
echo    网页客户端: http://127.0.0.1:%WEBPORT%/
echo ============================================================
echo.

rem ---------- 0. 环境检查 ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 找不到 node, 请先安装 Node.js
    pause
    exit /b 1
)
if not exist "%MOON%" (
    echo [错误] 找不到 %MOON%
    echo        put moon.exe in myFarm\bin
    pause
    exit /b 1
)

rem ---------- 1. 关闭已在运行的服务 ----------
echo [1/3] 检查并关闭已运行的服务...
set "FOUND=0"

rem 1.1 游戏服务: 只杀本仓库路径下的 moon.exe, 避免误杀别的项目
for /f "usebackq tokens=*" %%P in (`%PS% -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'moon.exe' -and ($_.ExecutablePath -like '*myFarm*' -or $_.ExecutablePath -like '*moon-master*') } | Select-Object -ExpandProperty ProcessId"`) do (
    echo       关闭 moon.exe ^(PID %%P^)
    taskkill /f /pid %%P >nul 2>&1
    set "FOUND=1"
)

rem 1.2 静态服务: 只杀命令行里带 serve.js 的 node
for /f "usebackq tokens=*" %%P in (`%PS% -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.js*' } | Select-Object -ExpandProperty ProcessId"`) do (
    echo       关闭 node serve.js ^(PID %%P^)
    taskkill /f /pid %%P >nul 2>&1
    set "FOUND=1"
)

if "!FOUND!"=="0" (
    echo       未发现已运行的服务
) else (
    echo       等待端口释放...
    call :sleep1
)

rem 端口仍被占用时给出提示(通常是别的程序占用了)
call :checkport %WEBPORT%
call :checkport 9001
call :checkport 9002

rem ---------- 2. 启动静态文件服务 ----------
echo.
echo [2/3] 启动静态文件服务...
start "html-client" /min node "%ROOT%\tools\serve.js" %WEBPORT%
call :sleep1

netstat -ano | findstr ":%WEBPORT% " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [错误] 静态服务没有在 %WEBPORT% 上监听, 请手动执行:
    echo        node "%ROOT%\tools\serve.js" %WEBPORT%
) else (
    echo        OK  http://127.0.0.1:%WEBPORT%/
)

rem ---------- 3. 启动游戏服务(前台) ----------
echo.
echo [3/3] 启动游戏服务, 按 Ctrl+C 退出...
echo.
"%MOON%" main.lua
set "CODE=%errorlevel%"

echo.
call :killweb
if not "%CODE%"=="0" (
    echo 游戏服务异常退出, errorlevel=%CODE%
    pause
)
echo 已关闭静态文件服务, 退出.
exit /b %CODE%

rem ============================================================
rem 子过程
rem ============================================================

:killweb
for /f "usebackq tokens=*" %%P in (`%PS% -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.js*' } | Select-Object -ExpandProperty ProcessId"`) do taskkill /f /pid %%P >nul 2>&1
exit /b 0

rem 约 1 秒; 用 ping 而不是 timeout, timeout.exe 在 stdin 被重定向时会直接报错退出
:sleep1
%SYS%\ping.exe -n 2 127.0.0.1 >nul
exit /b 0

:checkport
netstat -ano | findstr ":%1 " | findstr "LISTENING" >nul
if errorlevel 1 exit /b 0
echo [警告] 端口 %1 仍被占用, 可能是别的程序:
netstat -ano | findstr ":%1 " | findstr "LISTENING"
exit /b 0