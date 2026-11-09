# Aprendizados (armadilhas medidas)

Cada item foi medido num Galaxy S20 com LineageOS 24 e kernel 4.19.

## Sistema

- **Ubuntu 26.04 não serve em kernel 4.19.** O GNU tar do 26.04 falha com "Function not implemented" em qualquer arquivo. Use o 24.04 LTS (suporte até 2029).
- **O kernel Android não tem memória compartilhada SysV** (`shmget`). O PostgreSQL sempre cria um segmento SysV pequeno. Rode o PostgreSQL com o shim (`s20/shim/shmshim.c`) em `LD_PRELOAD`. O PostgreSQL embutido do Omni (pgserve) falha calado: o `omni install` diz sucesso e a API entra em loop "Database not ready".
- **Dois chroots no mesmo Android dividem a rede.** As portas colidem, e um teste de saúde pode responder pelo serviço errado.
- **`du` num chroot entra no `/proc` montado.** Exclua `proc`, `sys` e `dev`. Antes de apagar um chroot, confirme que nada está montado dentro dele.

## Acesso

- **A depuração sem fio do Android desliga no reboot e troca a porta.** Para administrar um servidor, use Tailscale com SSH.
- **Tailscale em modo userspace expõe todo o `127.0.0.1` à tailnet.** Proteja com ACL e autenticação própria.
- **Shell root do Android a partir do chroot:** `nsenter -t 1 -m -- /system/bin/sh`. O kernel não tem namespace IPC; use só `-m`.
- **Processo lançado em segundo plano por SSH sem `</dev/null` trava a sessão.** Redirecione stdin, stdout e stderr.
- **No `mksh` do Android, `r` é comando interno.** Não use `r` como nome de função.
- **`pkill -f <padrão>` pode matar a própria sessão** se a linha de comando contém o padrão.

## Bateria (Samsung, carregador max77705)

- `charging_enabled=0` só para a carga: o aparelho fica na tomada e a bateria não drena.
- `batt_slate_mode=1` corta a entrada: a bateria drena com o carregador ligado.
- Para um ciclo entre mínimo e máximo, controle o slate e **grave o modo atual**. Sem o modo gravado, a histerese não existe e a bateria oscila no mínimo.

## LineageOS

- O atualizador do LineageOS não faz versão maior. Com root e USB: grave o recovery novo, `adb reboot sideload-auto-reboot`, `adb sideload <zip>`, depois `adb root` e grave o boot com o patch do Magisk feito antes.
- `adb sideload` parar em cerca de 47% com "Total xfer: 1.00x" é sucesso.

## RAVI e Omni

- O Omni escreve a lista de conversas e, depois, uma linha `{"info":...}`. Leia só o primeiro documento JSON.
- No npm, limite a busca de versão ao `dist-tags.latest`: há pacotes com canal `next` e esquemas antigos de número.
- O Omni guarda alguns números de contato sem o 55. Rotas de contato por sufixo (`*DDD+número`) casam com e sem o 55.
- O provider Claude dentro do RAVI recusa rodar como root com permissões liberadas. Rode o RAVI com usuário próprio.
