# Desenvolvimento

## Mapa do projeto

| Pasta                      | Responsabilidade                                                          |
| -------------------------- | ------------------------------------------------------------------------- |
| `src/`                     | Interface React, contatos, campanhas, conexão e preferências              |
| `src/CampaignComposer.tsx` | Composição, edição e revisão das mensagens da campanha                    |
| `src/workspace/`           | Cards, configuração do quadro, modal compartilhado e históricos           |
| `server/routes/`           | Rotas HTTP de contas, contatos/importações, anexos, campanhas e Workspace |
| `server/campaigns.mjs`     | Fila, agendamento e limites compartilhados da conta                       |
| `server/whatsapp.mjs`      | Sessão local e transporte do WhatsApp                                     |
| `server/outbound.mjs`      | Identificação e acompanhamento de cada parte enviada                      |
| `server/delivery.mjs`      | Consolidação de confirmações e resultados incertos                        |
| `server/replies.mjs`       | Registro, associação e deduplicação de respostas                          |
| `server/workspace.mjs`     | Colunas e agregação dos cards por campanha/lista                          |
| `server/stats.mjs`         | Métricas usadas pelas campanhas e pelo Workspace                          |
| `server/store.mjs`         | Persistência JSON com troca atômica de arquivo                            |
| `server/migrations.mjs`    | Preservação de dados de instalações antigas                               |
| `shared/`                  | Revisão de mensagem usada pelo editor e pelos testes                      |
| `electron/`                | Janela desktop, instância única e encerramento                            |
| `scripts/`                 | Desenvolvimento, conferência e exportação do código                       |
| `tests/`                   | Testes de domínio, API, integração da biblioteca e interface              |

## Contratos que precisam ser preservados

- Um destinatário não é reenviado automaticamente após resultado incerto.
- Texto e cada anexo têm seus próprios IDs e confirmações. O conjunto só fica enviado quando todas as partes esperadas são confirmadas.
- Confirmações positivas não regridem quando chega um evento antigo de menor confirmação.
- O intervalo e os limites da conta continuam valendo ao trocar de campanha ou reiniciar.
- Excluir uma campanha preserva a contabilização dos envios das últimas 24 horas e o próximo horário disponível da conta.
- Edições só alteram campanhas sem nenhuma tentativa de envio. A revisão enviada pelo editor precisa coincidir com a revisão salva; alterações concorrentes são recusadas com HTTP 409.
- Uma edição é validada por completo antes de substituir os dados. Salvar preserva a identidade, a data de criação, a aprovação e o status atual da campanha.
- Uma campanha com destinatário em envio não pode ser excluída. Excluir remove suas referências dos quadros e seus registros de respostas.
- Respostas não alteram recibos de entrega. Cada mensagem recebida é deduplicada por conta/ID e creditada a uma campanha.
- A composição das listas na criação da campanha é preservada como histórico.
- Alterar a posição visual de um card não altera o estado da fila.
- Migrações preservam o conteúdo antigo e não reativam funcionalidades removidas.

## Testes

```powershell
npm run check
npm run test:ui
npm run test:campaigns-ui
npm run pack
npm run test:desktop
npm run source:check
```

A suíte principal usa bases temporárias em `test-results/` e transportes simulados. O teste visual sobe uma instância isolada com 500 contatos fictícios, sem conexão real. As capturas usadas no README são produzidas por esse teste.

`tests/campaign-management.test.mjs` cobre edição e exclusão pela API: preservação de identidade/agendamento, validação sem alteração parcial, conflito de revisão, bloqueio durante envio, conservação dos limites da conta e persistência. `tests/campaign-management-ui.mjs` exercita o modal em Campanhas e Workspace, a exibição do horário local, a seleção de contatos, a atualização da página e a confirmação de exclusão em telas desktop e mobile.

O teste desktop precisa do pacote já gerado em `release/win-unpacked/`. Ele usa outra pasta de dados e não abre a base pessoal.

As confirmações automáticas não substituem um teste real quando o WhatsApp muda. A suíte de compatibilidade executa o código da biblioteca instalada para reproduzir a colisão do ID de mídia e conferir os identificadores `_serialized`/`$1`. A dependência está fixada em uma revisão específica que contém essas correções; atualizá-la exige validar novamente o envio real de texto e imagem.

## Configuração local

| Variável              | Uso                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------- |
| `PORT`                | Porta do servidor; padrão `4317`                                                       |
| `DISPARO_DATA_DIR`    | Pasta privada da base; padrão `.data/` ao executar pelo código                         |
| `DISPARO_CHROME_PATH` | Caminho de um Chrome compatível quando a detecção automática não encontrar o navegador |

O serviço aceita somente acesso local e valida a origem das requisições. Não o exponha diretamente como uma aplicação pública de servidor.

## Compatibilidade de dados

O JSON mantém a versão de formato reconhecida pelo `Store`. Instalações anteriores podem conter dados de módulos removidos. A migração os arquiva em `legacyModules`, fora das rotas públicas, e conserva a contabilização de envios antigos até saírem das janelas de limite. Esse arquivo é dado privado do usuário e não acompanha o projeto.

## Exportação

`npm run source:export` usa uma lista explícita de pastas e arquivos do projeto. Antes de gerar o ZIP, rejeita arquivos de dados, executáveis, links simbólicos e padrões conhecidos de credenciais. Essa conferência complementa o `.gitignore`; não dispensa revisar arquivos novos antes de um commit.

O workflow em `.github/workflows/ci.yml` verifica formatação, testes, compilação e os arquivos da exportação. A geração do executável e os testes com WhatsApp real continuam separados da integração contínua.
