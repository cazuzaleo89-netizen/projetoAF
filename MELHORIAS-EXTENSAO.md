# Painel Fiscal — TEC Automator · Melhorias (v3.5.5)

Mudanças aplicadas sobre a v3.5.1, sem alterar a lógica de detecção do TEC nem o contrato com o painel externo.

## Confiabilidade
- **Retry com backoff nas chamadas à Claude.** Nova função central `claudeFetch()` que repete automaticamente em caso de 429 (limite), 529 (sobrecarga), 500/503 e erros de rede, com espera crescente e respeito ao cabeçalho `retry-after`. Antes, esses erros faziam partes do edital sumirem silenciosamente. Todas as 4 chamadas à API passaram a usar essa função.

## IA: modelo por tarefa (conforme combinado)
- **Parsing de edital agora usa o Sonnet** (`claude-sonnet-4-6`) — bem mais preciso para estruturar PDFs longos/bagunçados.
- **Tarefas leves continuam no Haiku** (`claude-haiku-4-5`): extração de conceitos e do nome do concurso (rápido e barato).
- Constantes centralizadas em `PF_MODELS`. Usuário avançado pode forçar outro modelo de parsing gravando a chave `pf_parse_model` no `chrome.storage` (padrão: Sonnet).
- A deduplicação ao juntar os trechos paralelos do edital agora **ignora acentos/maiúsculas** (usa `normStr`), evitando matérias/tópicos repetidos como "Informática" vs "informatica".

## Manutenção
- **Versão do manifest corrigida: 3.5.1 → 3.5.5** (alinha com o pacote; necessário para o Chrome reconhecer a atualização).
- **Logger central `PFLog`** no `background.js` e no `content.js`: os ~81 `console.log` agora só aparecem com `PF_DEBUG = true` (ou `_pfDebug = true` no content). Erros (`PFLog.error`) sempre aparecem. Console limpo no uso normal.

## Segurança
- **`web_accessible_resources`** do `pdf.worker` restrito aos domínios usados (TEC e seu GitHub Pages), em vez de `<all_urls>`.

## Manutenção do scraper do TEC
- **Seletores do TEC centralizados** num único objeto `TEC_SEL` (no `content.js`). As strings são idênticas às anteriores (comportamento preservado), mas agora ficam num só lugar — se o TEC mudar o HTML, basta ajustar ali.
- **Modo diagnóstico opt-in:** abra uma página de questão no TEC e rode `_pfDiag()` no console (F12) — ele mostra uma tabela com quantos elementos de questão/alternativas foram encontrados e avisa se a detecção falhou. Ajuda a diagnosticar rapidamente se o TEC mudar o layout.

## O que NÃO foi alterado (de propósito)
- **`all_frames: true`** no content script do TEC foi **mantido**. Mudar para `false` reduziria execuções duplicadas, mas se o TEC renderizar as questões dentro de um iframe isso quebraria a detecção — e não dá para validar isso sem o site logado. Se quiser testar, troque para `false` no `manifest.json` e confira se a captura de acertos/erros continua funcionando; se sim, pode manter.
- A lógica de detecção de questões/acertos no `content.js` foi preservada integralmente.

## Como atualizar a extensão
1. Descompacte o zip.
2. Em `chrome://extensions` (ou `edge://extensions`), com o **Modo do desenvolvedor** ligado, clique em **Atualizar** (ou remova a versão antiga e use **Carregar sem compactação** apontando para a pasta `painelfiscal`).
3. Como a versão subiu para 3.5.5, o navegador reconhece como atualização.
