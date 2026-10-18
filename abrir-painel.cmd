@echo off
rem Abre o painel de andamento da dublagem (http://localhost:8765)
start "" http://localhost:8765
node "%~dp002-ferramentas\painel.mjs"
