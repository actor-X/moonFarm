@echo off
cd /d %~dp0
..\..\target\debug\moon.exe main.lua
if errorlevel 1 pause
