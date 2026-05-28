# Painel Fiscal — Atualização

Melhorias aplicadas sobre a versão original, sem alterar os dados nem a lógica de estudo já existente. Seu histórico continua salvo no mesmo lugar (localStorage, chave `pf4`).

## O que mudou

### 0. Cronômetro flutuante entre as abas (unificado)
Antes existiam **dois cronômetros separados**: o painel flutuante (que era só uma demonstração — não salvava sessões, usava uma lista de disciplinas fixa e tinha um placar ✓/✗ que não gravava nada) e o cronômetro "de verdade" da aba Cronômetro. Agora há **um único timer**: o painel flutuante passou a controlar e espelhar a sessão real e fica visível **em todas as abas**. Assim você pode iniciar o estudo e navegar pelo Dashboard, Questões, etc., sem perder o cronômetro de vista.
- Iniciar/Pausar/Retomar/Encerrar no painel acionam o timer real (salva no histórico, dá XP, respeita o Pomodoro).
- A disciplina do painel fica sincronizada com a da aba Cronômetro (lista real de disciplinas).
- O placar ✓/✗ do painel (que não gravava nada) foi ocultado — questões continuam sendo registradas na aba Questões.
- Corrigido um conflito do atalho de teclado (Espaço) que era capturado duas vezes.

### 1. Navegação no celular (correção importante)
Na versão anterior, em telas pequenas a barra lateral inteira ficava escondida e **não havia nada no lugar** — ou seja, no celular não dava para trocar de aba. Agora há uma **barra de navegação inferior** (Painel, Timer, Questões, Metas, Config) que aparece só no mobile e fica sincronizada com a navegação do desktop.

### 2. Script quebrado removido
O `index.html` carregava `mobile-patch.js`, que não existia (erro 404 a cada acesso). A referência foi removida.

### 3. App instalável + offline (PWA)
Adicionados `manifest.webmanifest`, `sw.js` (service worker) e ícones. Agora o painel pode ser **instalado na tela inicial** do celular/desktop e **funciona sem internet** depois do primeiro acesso. Ideal para estudar em qualquer lugar.

### 4. Cronômetro flutuante reposicionado no mobile
O cronômetro flutuante passava por cima da nova barra inferior e bloqueava os toques. No celular ele agora fica acima da barra, sem atrapalhar.

### 5. Importação mais segura
Importar um `.json` substitui todos os dados. Agora aparece uma **confirmação** antes, evitando perda acidental de histórico.

### 6. Ajustes de tela pequena e telas com notch
Layout de uma coluna em telas bem estreitas (≤380px) e respeito às áreas seguras (`safe-area-inset`) em celulares com notch/barra inferior.

## Arquivos
- `index.html` — app principal (atualizado)
- `manifest.webmanifest` — metadados de instalação (PWA)
- `sw.js` — service worker (cache/offline)
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — ícones do app

## Como publicar no GitHub Pages
1. Suba **todos** os arquivos desta pasta para o repositório `projetofiscal` (na mesma raiz onde está o `index.html` hoje).
2. Confirme que GitHub Pages está apontando para a branch correta.
3. Acesse pelo celular e use "Adicionar à tela inicial" para instalar.

> Importante: o service worker e a instalação só funcionam via HTTPS (GitHub Pages já é HTTPS). Abrir o arquivo direto do disco (`file://`) não ativa o modo offline — isso é normal.

## Observação sobre cache (PWA)
Como o app passa a ser cacheado, após publicar uma nova versão pode ser necessário recarregar a página uma vez (ou fechar/reabrir o app instalado) para ver as mudanças. Se quiser forçar atualização no futuro, troque a linha `const CACHE = 'painel-fiscal-v1'` em `sw.js` para `v2`, `v3`, etc.
