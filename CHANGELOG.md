# Histórico de versões

As versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/). Este histórico descreve a edição local e pública do Disparo.

## [0.5.0] — 2026-10-25

### Novidades

- Edição pelo modal da campanha, acessível em **Campanhas** e no **Workspace**. Permite alterar nome, conta, destinatários, texto, anexos, data, horário e limites antes do primeiro envio.
- Exclusão de campanhas com confirmação no próprio modal. Remove a campanha, seus resultados e respostas registradas dos relatórios; preserva a base de contatos, os anexos e as mensagens que já estão no WhatsApp.
- Novo comando `npm run test:campaigns-ui` para validar o fluxo de edição e exclusão no navegador, com dados fictícios e transporte simulado.

### Comportamento e integridade dos dados

- Salvar uma edição mantém o status: campanhas agendadas continuam agendadas; rascunhos e campanhas pausadas não começam a enviar ao salvar.
- A edição fica disponível para rascunhos, campanhas agendadas e campanhas pausadas, desde que todos os destinatários estejam pendentes e nenhuma tentativa de envio tenha começado.
- Uma edição desatualizada, feita em outra janela, é recusada. O usuário precisa reabrir o editor para carregar a versão atual.
- A mensagem e os destinatários são validados antes de alterar o registro salvo. Campos inválidos ou um agendamento no passado não sobrescrevem a campanha existente.
- O editor abre com os destinatários já salvos. Selecionar novamente uma lista ou toda a base recalcula a seleção conforme os contatos atuais.
- Para remover o agendamento de uma campanha já aprovada, pause-a antes de editar.
- A exclusão aguarda qualquer envio em andamento terminar. Os envios das últimas 24 horas continuam contando para os limites da conta, mesmo após excluir a campanha.

### Verificação

- 50 testes automatizados de domínio, API, persistência, exportação, respostas e compatibilidade do transporte.
- Fluxo visual de edição e exclusão testado em tela desktop e em viewport de 390 px, incluindo horário local, alteração de destinatários e atualização da página.
- Formatação, compilação e conferência dos arquivos publicáveis.
- Testes automatizados usam transporte simulado e não enviam mensagens reais pelo WhatsApp.

### Atualização

O formato dos dados locais permanece na versão 1. Feche o aplicativo, faça uma cópia da pasta de dados indicada em **Configurações** e siga as [instruções de atualização](README.md#atualizar-preservando-seus-dados).

## 0.4.1 — Base anterior

- Aplicativo desktop com Visão geral, Campanhas, Contatos e listas, Workspace e WhatsApp.
- Envio de texto e anexos, agendamento, intervalo e limites por conta, confirmações de envio e histórico de respostas.
- Persistência local, licença MIT, exportação do código e verificações automáticas no GitHub.

[0.5.0]: https://github.com/iacomexcelencia-rgb/disparo/releases/tag/v0.5.0
