# Integração OpenCode com Cuscuz-MED

Este documento explica como o OpenCode foi integrado ao projeto Cuscuz-MED para facilitar o desenvolvimento, deploy e manutenção.

## 📋 Configuração

A integração está definida no arquivo [`opencode.json`](opencode.json) na raiz do projeto.

## 🤖 Agentes Especializados

Foram criados cinco agentes especializados para tarefas comuns no projeto:

### `dev-server`
- **Descrição**: Inicia e gerencia o servidor de desenvolvimento
- **Ferramentas**: shell
- **Uso**: Inicie o servidor de desenvolvimento com `npm run dev`

### `dependency-manager`
- **Descrição**: Gerencia dependências do projeto
- **Ferramentas**: shell
- **Uso**: Instale/atualize dependências com npm

### `deploy-assistant`
- **Descrição**: Auxilia no deploy do Cuscuz-MED para o Railway.app
- **Ferramentas**: shell, read, write
- **Uso**: Siga o guia de deploy em DEPLOY.md

### `question-bank-manager`
- **Descrição**: Gerencia o banco de questões do Hardworq
- **Ferramentas**: shell, read, write
- **Uso**: Trabalhe com os scripts de atualização do banco de questões

### `github-assistant`
- **Descrição**: Gerencia operações com GitHub via servidor MCP
- **Ferramentas**: mcp
- **Uso**: Realiza operações de repositório, issues, PRs e commits diretamente através do servidor MCP do GitHub

## ⚡ Comandos Disponíveis

Foram definidos os seguintes comandos prontos para uso:

### `/run dev`
Inicia o servidor de desenvolvimento do Cuscuz-MED

### `/run install`
Instala todas as dependências do projeto usando npm

### `/run deploy:railway`
Auxilia no processo de deploy para o Railway.app seguindo o guia em DEPLOY.md

### `/run bank:update`
Executa o script de atualização do banco de questões: `node scripts/baixar-banco.mjs`

### `/run github:status`
Verifica o status e informações do repositório GitHub via servidor MCP

## 🔧 Como Usar

1. **Iniciar desenvolvimento**: Use `/run dev` para iniciar o servidor local
2. **Instalar dependências**: Use `/run install` após clonar o projeto ou atualizar dependências
3. **Atualizar banco de questões**: Use `/run bank:update` para baixar a versão mais recente do banco do Hardworq
4. **Deploy**: Use `/run deploy:railway` para obter assistência no deploy para o Railway.app

## 📝 Observações

- Os agentes têm permissões específicas para executar apenas as operações necessárias
- A configuração segue o schema oficial do OpenCode V2
- Esta integração pode ser estendida com mais agentes e comandos conforme necessário

## 🔗 Recursos Relacionados

- [DEPLOY.md](./DEPLOY.md) - Guia completo para deploy no Railway.app
- [README.md](./README.md) - Instruções básicas de execução
- [.github/workflows/banco-questoes.yml](./.github/workflows/banco-questoes.yml) - Workflow automático de atualização do banco