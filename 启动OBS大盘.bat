@echo off
chcp 65001 >nul 2>&1
title OBS Dashboard

cd /d C:\Users\EDY\WorkBuddy\Claw

node start-dashboard.js

pause