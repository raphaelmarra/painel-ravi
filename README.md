# Painel RAVI

Painel web de botões para operar um servidor [RAVI](https://github.com/filipexyz/ravi) sem terminal. Cada botão executa um comando fixo e seguro; não há IA no meio. Roda em qualquer servidor Linux com RAVI e, opcionalmente, num celular Android transformado em servidor.

## Funcionalidades

**WhatsApp**
- Nova conexão em passos, com **pair code** (código de 8 caracteres) ou QR.
- Código de pareamento para conexão existente desconectada.
- Trocar o agente que responde uma conexão.
- **Rotas por conversa:** escolha um grupo ou contato numa lista e mande para outro agente. Também por prefixo de número (DDD ou país).

**Agentes**
- Criar agente com provider Claude, Codex ou Pi (com escolha de modelo).
- Editar as instruções, com histórico das versões anteriores.
- Conversa de teste e apagar agente (a pasta vai para um arquivo, não some).

**Providers de IA**
- **Claude** por assinatura (código do `claude setup-token`).
- **Codex** por assinatura do ChatGPT (login por código).
- **Pi:** mais de 20 serviços por chave de API (DeepSeek, OpenAI, Gemini, OpenRouter, Groq, xAI, Mistral…). Testa a chave na hora.
- Guias "Como conseguir" ao lado de cada credencial.
- Ligar o servidor ao Ravi Console oficial.

**Operação**
- Estado dos serviços com nomes simples (ponte do WhatsApp, banco de dados, fila interna, RAVI).
- Buscar atualizações de RAVI, Omni, Bun, Node, PM2, Tailscale e Pi, com política de versão maior.
- Registros técnicos, diagnóstico e religar serviços numa área "Avançado".
- **Vários servidores:** um seletor no topo troca entre os seus servidores.

**Segurança**
- PIN para todo acesso, com freio de tentativas que dobra a espera até 60 minutos.
- Lista fechada de ações, sem shell; parâmetros validados.
- Confirmação para ações destrutivas, de credencial e de envio.
- Auditoria de cada clique; segredos nunca voltam na tela.
- **Três modos:** `completo` (servidor comum), `vps` (só leitura e ações reversíveis, para produção) e `android` (inclui bateria, tela e guardião).

## Instalação num servidor Linux

Requisitos no servidor: usuário `ravi` com RAVI, Omni, PM2 e [Bun](https://bun.sh); [Tailscale](https://tailscale.com) para o acesso. No seu computador: `bash`, `ssh` e acesso SSH como root ao servidor.

```bash
cp config.env.example config.env   # preencha SERVIDOR_HOST, SERVIDOR_SSH_KEY, SERVIDOR_MODO
cd painel && ./scripts/implantar-servidor.sh
```

O script copia o painel para `/home/ravi/painel`, sobe o processo `painel` no PM2, publica na tailnet com `tailscale serve` e define o PIN a partir do arquivo indicado em `PIN_ARQUIVO`. Passo a passo em [`docs/instalacao-servidor.md`](docs/instalacao-servidor.md).

## Celular Android como servidor (opcional)

Um celular antigo com LineageOS e Magisk vira um servidor RAVI dedicado. A pasta [`extras/android/`](extras/android) traz:

- **Guardião:** religa serviços travados, backup diário, atualização semanal com volta automática e **ciclo de bateria** (ex.: entre 30% e 80%).
- **Base:** boot, chroot Ubuntu e enxugamento do Android.
- **Shim de memória compartilhada:** permite rodar o PostgreSQL no kernel do Android.

Guia em [`docs/instalacao-android.md`](docs/instalacao-android.md), testado num Galaxy S20. Armadilhas medidas em [`docs/aprendizados.md`](docs/aprendizados.md).

## Segurança da rede

O painel escuta só em `127.0.0.1` e sai pela tailnet com `tailscale serve`. Num servidor com Tailscale em modo **userspace** (comum em containers e no Android), o `127.0.0.1` fica alcançável pela tailnet em **todas** as portas. Nesse caso, use uma ACL do Tailscale: modelo em [`docs/acl-tailscale.md`](docs/acl-tailscale.md).

Nenhum segredo vai para o repositório. O `config.env` fica fora do Git; PIN, tokens e chaves ficam no servidor ou em `~/.credentials/`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `painel/src/` | servidor (`server.ts`), lista de ações (`acoes.ts`), interface (`ui.html`) |
| `painel/scripts/` | implantação, consulta de versões, atualização com volta, PIN |
| `extras/android/` | guardião, base do Android e shim do PostgreSQL |
| `docs/` | instalação, aprendizados, ACL, tabela de botões |

## Limites conhecidos

- A geração real de pair code e o roteamento de uma mensagem por rota de contato ainda não foram testados de ponta a ponta.
- No modo `completo`, atualizar pelo painel não está disponível: atualize pelo gerenciador do servidor.
- Rotas de contato aparecem só para contatos com número; contatos com código de privacidade do WhatsApp (`@lid`) não aparecem.

## Licença

MIT. Veja [`LICENSE`](LICENSE).
