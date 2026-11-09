# ravi-s20-servidor

Transforma um celular Android antigo (testado num Galaxy S20) num servidor dedicado para o [RAVI](https://github.com/filipexyz/ravi), com um painel de botões para operar tudo sem terminal.

O que vem aqui:

- **Painel:** página web de botões fixos para WhatsApp (pair code e QR), agentes, rotas por conversa, providers (Claude, Codex e Pi), alertas, atualizações e manutenção. Abre na tela do próprio celular e em outros aparelhos pelo Tailscale.
- **Guardião:** vigia que religa serviços travados, faz backup diário, atualiza toda semana com volta automática e controla o ciclo da bateria.
- **Base do S20:** scripts de boot, montagem do chroot e enxugamento do Android.
- **Shim de memória compartilhada:** permite rodar o PostgreSQL dentro do Android.

## Como funciona

```
Android (LineageOS + Magisk)
 ├── /data/adb/service.d/ravi-boot.sh   sobe tudo no boot
 ├── guardião (root)                    vigia, backup, atualização, bateria
 ├── ajudante root do painel            ações que exigem root, por lista fechada
 └── chroot Ubuntu 24.04 (/data/local/ravi)
      ├── tailscaled (userspace) + sshd em 127.0.0.1
      └── usuário ravi, sob PM2:
           RAVI · Omni (WhatsApp) · NATS · PostgreSQL · painel (127.0.0.1:8090)
```

O painel escuta só em `127.0.0.1` e sai para a tailnet pelo `tailscale serve`. Cada botão executa um comando fixo de uma lista fechada, sem shell. Ações que exigem root passam por um ajudante com lista própria.

## Requisitos

- Android com bootloader desbloqueado, LineageOS e Magisk (root). Testado: Galaxy S20 (SM-G980F), LineageOS 24.0, Magisk 31.1.
- Uma conta no [Tailscale](https://tailscale.com) e o Tailscale no computador de onde você administra.
- Um computador com `bash`, `ssh` e [Bun](https://bun.sh) para implantar o painel.

## Instalação (resumo)

A parte do Android e do chroot é manual e depende do aparelho. Os passos estão em [`docs/instalacao-s20.md`](docs/instalacao-s20.md) e as armadilhas em [`docs/aprendizados.md`](docs/aprendizados.md). Em resumo:

1. Instale LineageOS e Magisk.
2. Monte o chroot Ubuntu 24.04 em `/data/local/ravi` com os scripts de [`s20/base/`](s20/base).
3. Crie o usuário `ravi` (grupos `aid_inet` 3003 e `aid_net_raw` 3004) e instale Bun, RAVI, Omni, PM2 e PostgreSQL 16.
4. Compile o shim ([`s20/shim/shmshim.c`](s20/shim/shmshim.c)) e rode o PostgreSQL com `LD_PRELOAD`.
5. Instale o guardião ([`s20/guardiao/`](s20/guardiao)) e o boot ([`s20/base/ravi-boot.sh`](s20/base/ravi-boot.sh)).

Depois, implante o painel a partir do seu computador:

```bash
cp config.env.example config.env   # preencha com o seu S20 e a sua tailnet
cd painel && ./scripts/implantar.sh
```

O script cria um PIN inicial e o guarda no arquivo indicado em `PIN_ARQUIVO`, fora do repositório. Troque o PIN pelo painel em **Sistema**.

## Segurança

- **Nenhum segredo vai para o repositório.** O `config.env` fica fora do Git. PIN, tokens e chaves ficam no aparelho ou em `~/.credentials/`.
- **Todo acesso ao painel exige PIN.** O freio de tentativas dobra a espera a cada bloqueio, até 60 minutos.
- **Atenção ao Tailscale em modo userspace:** ele entrega ao `127.0.0.1` do celular conexões da tailnet para **qualquer** porta. Escutar em loopback não isola os serviços da tailnet. Use uma ACL do Tailscale que libere só as portas 22 e 443 do servidor. Modelo em [`docs/acl-tailscale.md`](docs/acl-tailscale.md).
- **Modo VPS (opcional):** o mesmo painel roda numa VPS com `PAINEL_MODO=vps`. Nesse modo, o servidor só aceita leitura e ações reversíveis, e recusa ações destrutivas com `403`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `painel/src/` | servidor (`server.ts`), lista de ações (`acoes.ts`), interface (`ui.html`), envio de alerta |
| `painel/scripts/` | implantação, ajudante root, consulta de versões, atualização com volta, PIN |
| `s20/guardiao/` | guardião, sondas de saúde, backup, configuração |
| `s20/base/` | boot, montagem e entrada no chroot, enxugamento do Android |
| `s20/shim/` | shim de memória compartilhada para o PostgreSQL |
| `docs/` | instalação, aprendizados, ACL, tabela de botões |

## Limites conhecidos

- A geração real de pair code e o roteamento de uma mensagem por rota de contato não foram testados de ponta a ponta.
- Na tela do próprio celular, um servidor de outro aparelho não abre: o Android fica fora da tailnet (só o chroot está nela).
- O LineageOS e o Magisk só atualizam à mão, com cabo USB e recovery.

## Licença

MIT. Veja [`LICENSE`](LICENSE).
