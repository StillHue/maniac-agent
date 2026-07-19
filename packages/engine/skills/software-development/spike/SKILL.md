---
name: spike
description: "Investigação rápida (spike) para explorar soluções desconhecidas."
version: 1.0.0
author: Maniac
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [research, spike, prototyping, exploracao]
    related_skills: [plan, systematic-debugging]
---

# Spike

## Overview
Um spike é uma investigação com tempo limitado para responder a uma pergunta específica.
Não produz código para produção — produz conhecimento.

## Método

1. **Decompor**: Quebre a questão em partes menores e verificáveis
2. **Alinhar**: Confirme o entendimento com o usuário
3. **Pesquisar**: Use grep, read, web_search para coletar dados
4. **Construir**: Crie protótipo mínimo que responda à questão
5. **Veredito**: Responda VALIDADO / PARCIAL / INVALIDADO

## Formato do Veredito
```
## Veredito: VALIDADO
- O que foi descoberto:
- Implicações:
- Recomendação:
```

## Estrutura de Saída
Salve spikes em `spikes/NNN-descricao/` com README.md explicando as descobertas.
