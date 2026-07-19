---
name: systematic-debugging
description: "Depuração sistemática em 4 fases: entender antes de corrigir."
version: 1.0.0
author: Maniac
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [debugging, troubleshooting, root-cause, investigacao]
    related_skills: [spike, plan]
---

# Depuração Sistemática

## Overview
Siga estas 4 fases rigorosamente antes de fazer qualquer modificação no código.
Nunca pule a fase de investigação.

## Fase 1: Causa Raiz
- Leia o erro completo (stack trace, logs)
- Reproduza o problema
- Entenda o fluxo de dados
- Identifique a asserção/exceção específica

## Fase 2: Análise de Padrões
- grep por padrões similares no código
- Verifique se é um bug conhecido
- Compare com implementações similares

## Fase 3: Hipótese e Teste
- Formule hipótese específica
- Crie teste mínimo que falha
- Verifique a hipótese

## Fase 4: Implementação
- Corrija a causa raiz, não o sintoma
- Execute o teste que falhava
- Varredura de regressão

## Regras de Ouro
1. SE O ERRO PARECE MISTERIOSO, VOCÊ NÃO TEM DADOS SUFICIENTES
2. UMA MUDANÇA DE CADA VEZ — SEMPRE
3. NÃO CORRIJA O QUE VOCÊ NÃO ENTENDE
