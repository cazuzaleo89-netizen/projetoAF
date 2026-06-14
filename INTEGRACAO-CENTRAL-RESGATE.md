# Central de Resgate

## Como funciona

1. A extensao envia o `wrongBank` ao projetoAF.
2. O painel seleciona um lote diario de 6, 12 ou 20 revisoes.
3. A prioridade considera atraso, reincidencia de erro e diversidade de materias.
4. O botao `Abrir` leva para a questao no TEC.
5. `Errei`, `Dificil` e `Facil` enviam o resultado para a extensao, que reage agenda via SM-2.

## Regra antiacumulo

- O acumulado continua visivel, mas somente o lote diario vira compromisso imediato.
- Ao concluir o lote, o painel recomenda encerrar sem culpa.
- O botao `+5 hoje` permite ampliar conscientemente a carga.
- Cada materia recebe no maximo tres questoes no primeiro passe, evitando monotonia.

## Instalacao

- Publique os arquivos deste diretorio no GitHub Pages do projetoAF.
- Recarregue a extensao Painel Fiscal v3.9.2.
- Abra o projetoAF e aguarde o indicador `Extensao conectada`.
