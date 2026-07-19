---
name: plan
description: "Planejamento estruturado com tarefas atômicas e verificação."
version: 1.0.0
author: Maniac
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [planning, task-breakdown, architecture]
    related_skills: [test-driven-development, systematic-debugging]
---

# Plan

## Overview
Crie planos de implementação com tarefas pequenas (2-5 min cada),
caminhos de arquivo exatos, e critérios de verificação.

## Estrutura do Plano
```markdown
# Plano: [Título]

## Análise
- Requisitos:
- Arquivos afetados:
- Riscos:

## Tarefas
- [ ] 1. Primeira tarefa (2min)
  - Arquivo: `caminho/arquivo.ts`
  - Ação: descreva exatamente o que fazer
  - Verificação: como saber se está certo

- [ ] 2. Segunda tarefa (3min)
```

## Princípios
- **DRY**: Não duplique lógica
- **YAGNI**: Não construa o que não precisa agora
- **TDD**: Teste antes de implementar quando possível
- **Tarefas atômicas**: Cada tarefa = 2-5 min, uma responsabilidade

## Armazenamento
Salve em `.hermes/plans/` ou na raiz do projeto como `PLANO-AAAAMMDD-titulo.md`.
