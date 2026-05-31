# Painel Fiscal v3.6.0 — Compatibilidade Web

## O que mudou

Esta versão adiciona suporte para abrir o popup como **página web standalone**,
mantendo a extensão Chrome 100% funcional sem alterações.

## Como funciona

### Como extensão (comportamento idêntico ao v3.5.5)
- Instale normalmente via `chrome://extensions` → "Carregar sem compactação"
- Clique no ícone na barra do Chrome → popup abre normalmente
- Captura automática de questões no TecConcursos via `content.js`
- Todos os dados em `chrome.storage.local`

### Como página web
- Abra `popup.html` diretamente no browser (ou hospede no GitHub Pages)
- Ou copie os arquivos para o seu repositório GitHub Pages existente
- O arquivo `compat.js` detecta automaticamente que está fora da extensão
  e substitui as APIs do Chrome por equivalentes web:

| API da extensão           | Equivalente web              |
|---------------------------|------------------------------|
| `chrome.storage.local`    | `localStorage`               |
| `chrome.tabs.create(url)` | `window.open(url, '_blank')` |
| `chrome.runtime.sendMessage` | barramento in-page         |
| `chrome.alarms`           | `setTimeout / setInterval`   |
| `chrome.notifications`    | `Notification API` nativa    |

## Dados: extensão vs. página web

Os dois contextos têm **armazenamentos separados**:
- Extensão → `chrome.storage.local` (privado da extensão)
- Página web → `localStorage` do domínio onde for hospedada

Para transferir dados entre um e outro, use o **Export Backup** e **Import Backup**
disponíveis na aba de configurações do painel.

## Limitações da versão web

- **Captura automática de questões** no TecConcursos não funciona
  (requer `content.js` injetado pela extensão)
- Notificações dependem de permissão do browser
- O badge de contagem no ícone da extensão não aparece (não existe ícone)

## Arquivos novos

- `compat.js` — shim de compatibilidade (detecta contexto automaticamente)
