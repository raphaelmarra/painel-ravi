# Instalação num Android (testado no Galaxy S20)

Passos usados num Galaxy S20 (SM-G980F). Outros aparelhos funcionam se tiverem LineageOS e Magisk. Faça backup antes: os passos 1 e 2 apagam o aparelho.

## 1. LineageOS e Magisk

1. Desbloqueie o bootloader e instale o LineageOS pelo guia oficial do seu aparelho.
2. Instale o Magisk: aplique o patch no `boot.img` pelo app do Magisk e grave o boot.
3. Ligue a depuração USB para a primeira configuração. Depois, o acesso passa a ser pelo Tailscale.

## 2. Chroot Ubuntu 24.04

Use o Ubuntu **24.04 LTS** ("ubuntu-base" para arm64). O 26.04 não funciona em kernel 4.19 (ver `aprendizados.md`).

```sh
# no Android, como root
mkdir -p /data/local/ravi /data/adb/ravi
tar -xzf ubuntu-base-24.04.5-base-arm64.tar.gz -C /data/local/ravi
cp extras/android/base/mount.sh extras/android/base/umount.sh extras/android/base/chroot.sh /data/adb/ravi/
sh /data/adb/ravi/mount.sh
echo "nameserver 9.9.9.9" > /data/local/ravi/etc/resolv.conf
```

Dentro do chroot (`sh /data/adb/ravi/chroot.sh /bin/bash`):

```sh
groupadd -g 3003 aid_inet; groupadd -g 3004 aid_net_raw
usermod -aG aid_inet,aid_net_raw root; usermod -g 3003 _apt
apt-get update && apt-get -y full-upgrade
apt-get -y install --no-install-recommends ca-certificates curl unzip git openssh-server postgresql xz-utils libatomic1 procps iproute2
useradd -m -s /bin/bash -G aid_inet,aid_net_raw ravi
```

Os grupos 3003 e 3004 dão acesso à rede a usuários sem root no Android.

## 3. Node, Bun, RAVI, Omni e PM2 (usuário ravi)

- Node LTS: binário oficial do nodejs.org em `/usr/local` (confira o `SHASUMS256.txt`).
- Bun: instalador oficial do bun.sh.
- `bun add -g ravi.bot @automagik/omni pm2`

## 4. PostgreSQL com o shim

```sh
gcc -O2 -shared -fPIC -o /usr/local/lib/libshmshim.so extras/android/shim/shmshim.c -lpthread
# como ravi
LD_PRELOAD=/usr/local/lib/libshmshim.so /usr/lib/postgresql/16/bin/initdb -D ~/.pg/data -U ravi
LD_PRELOAD=/usr/local/lib/libshmshim.so pm2 start /usr/lib/postgresql/16/bin/postgres --name omni-pg --interpreter none -- -D /home/ravi/.pg/data
```

Configure o PostgreSQL para escutar só em `127.0.0.1`. Crie o usuário e o banco `omni` com senha aleatória e rode `omni install --database-url postgresql://omni:<senha>@127.0.0.1:5432/omni`.

## 5. RAVI

Grave `OMNI_API_URL` e `OMNI_API_KEY` em `~/.ravi/.env`, rode `ravi daemon start` e `pm2 save`. O provider (Claude, Codex ou Pi) se configura depois pelo painel.

## 6. Tailscale, SSH e boot

- Tailscale: binários estáticos de pkgs.tailscale.com, com `tailscaled --tun=userspace-networking`.
- SSH: `ListenAddress 127.0.0.1`, só chave, sem senha.
- Boot: copie `extras/android/base/ravi-boot.sh` para `/data/adb/service.d/` e o guardião para `/data/adb/ravi/guard/`.
- Reinicie o aparelho e confira que tudo sobe sozinho.

## 7. Painel

Do seu computador: `cp config.env.example config.env`, preencha os dados e rode `painel/scripts/implantar-android.sh` (com `ANDROID_HOST` no config.env).
