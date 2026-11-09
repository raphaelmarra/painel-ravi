# Instalação num servidor Linux

Vale para VPS ou máquina em casa com Ubuntu ou Debian.

## 1. No servidor

1. Crie o usuário `ravi` e instale, nele, [Bun](https://bun.sh) e os pacotes globais: `bun add -g ravi.bot @automagik/omni pm2`.
2. Configure o RAVI e o Omni (`omni install`, `ravi daemon start`) e confirme com `ravi daemon status`.
3. Instale o [Tailscale](https://tailscale.com) e entre na sua tailnet.

## 2. No seu computador

```bash
cp config.env.example config.env
```

Preencha:

- `SERVIDOR_HOST` e `SERVIDOR_SSH_KEY`: endereço do servidor e chave SSH de root.
- `SERVIDOR_MODO`: `completo` para servidor de testes ou pessoal; `vps` para servidor em produção (só leitura e ações reversíveis).
- `SERVIDORES_JSON`: os servidores do seletor, com o endereço do `tailscale serve` de cada um.
- `PIN_ARQUIVO`: arquivo local com o PIN (4 a 12 dígitos). Crie o arquivo antes: `mkdir -p ~/.credentials && echo 123456 > ~/.credentials/painel-pin.txt` (troque o número).

Implante:

```bash
cd painel && ./scripts/implantar-servidor.sh
```

## 3. Abrir

Em qualquer aparelho da sua tailnet, abra `https://<nome-do-servidor>.<sua-tailnet>.ts.net` e entre com o PIN. Troque o PIN em **Sistema**.

## 4. Proteger

Se o Tailscale do servidor roda em modo userspace, aplique a ACL de [`acl-tailscale.md`](acl-tailscale.md). Em modo normal (TUN), o `127.0.0.1` do servidor não fica exposto, e a ACL é recomendada mas não obrigatória.
