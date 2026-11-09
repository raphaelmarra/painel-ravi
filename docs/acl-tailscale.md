# ACL do Tailscale para o servidor

O tailscaled em modo userspace entrega ao `127.0.0.1` do celular as conexões da tailnet para qualquer porta. Sem ACL, qualquer aparelho da tailnet alcança o banco, a fila e a API do WhatsApp.

## Política

No painel do Tailscale, em **Access controls**, junte este trecho à política atual:

```json
{
  "tagOwners": { "tag:servidor-ravi": ["autogroup:admin"] },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"] },
    { "src": ["autogroup:member"], "dst": ["tag:servidor-ravi"], "ip": ["tcp:22", "tcp:443", "tcp:80"] }
  ]
}
```

Depois, em **Machines**, adicione a tag `tag:servidor-ravi` ao nó do celular. Nó com tag não tem a chave expirando.

## Prova

```bash
for p in 22 443 4222 5432 8882 8090; do printf "%s " $p; nc -z -G 4 <ip-do-servidor> $p && echo aberta || echo fechada; done
```

Esperado: 22 e 443 abertas; 4222, 5432, 8882 e 8090 fechadas.
