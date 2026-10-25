# Como contribuir

O Disparo mantém o foco em cinco módulos: Visão geral, Campanhas, Contatos e listas, Workspace e WhatsApp.

## Preparar o ambiente

Use Node.js 22.12 ou superior e instale as versões do lockfile:

```powershell
npm ci
npm run dev
```

## Propor uma alteração

1. Descreva o problema e o comportamento esperado em uma issue ou pull request.
2. Mantenha o escopo pequeno e preserve os registros locais existentes.
3. Use os transportes simulados dos testes. Não faça disparos reais em testes automatizados.
4. Formate e confira o projeto:

```powershell
npm run format
npm run check
npm run source:check
```

Para alterações de interface, execute também `npm run test:ui`. Para alterações no pacote desktop, gere o executável e execute `npm run test:desktop` no Windows.

Inclua na descrição da pull request o problema resolvido e os testes executados. Não envie bases de contatos, exportações, sessões do WhatsApp, QR codes ou credenciais em commits, capturas ou relatos públicos.

## Estrutura e publicação

O mapa do código e os critérios de confirmação estão em [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md). O workflow do GitHub executa as verificações de código e a conferência da exportação em Windows e Linux, sem conectar ao WhatsApp.

Para preparar uma cópia do código para distribuição, use `npm run source:export`. Executáveis pertencem à seção Releases do GitHub; não são incluídos no repositório de código.
