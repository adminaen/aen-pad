# Publicando na internet (Hivelocity + Cloudflare + HTTPS automático)

Este guia sobe o app num VPS público, com HTTPS automático (via
[Caddy](https://caddyserver.com/), que emite e renova o certificado
sozinho) e um domínio seu apontado pelo Cloudflare. Ao final, o app fica
acessível de qualquer lugar em `https://SEUDOMÍNIO`.

Exemplo usado neste guia: `pad.admiravelempregonovo.com.br`. Troque pelo seu.

## 1. Provisionar o VPS na Hivelocity

1. Entre no portal da Hivelocity (myVelocity) e clique em **Add Server**.
2. Escolha **Instant Server** (ou "Virtual Device"/Cloud Compute,
   dependendo do que aparecer no seu painel) — não precisa de dedicado
   pra esse app.
3. Escolha a localização (a mais próxima de você/seus usuários).
4. Sistema operacional: **Ubuntu 22.04** ou **24.04 LTS**.
5. Plano: o menor disponível já é suficiente (app leve, sem banco
   externo — o "banco" é um arquivo SQLite).
6. No passo de acesso, prefira **adicionar sua chave SSH pública** em vez
   de senha, se a opção existir (mais seguro). Se só der pra usar senha,
   anote — você vai trocar por chave SSH depois de entrar.
7. Finalize o pedido/checkout e inicie o deploy. Costuma levar de alguns
   minutos a ~1h dependendo do tipo de servidor.
8. Quando terminar, anote o **IP público** do servidor (aparece no
   painel, na página do dispositivo).

Referências: [Server Configuration](https://www.hivelocity.net/kb/server-configuration/) ·
[Guia do painel de servidor dedicado](https://www.hivelocity.net/kb/a-guide-to-the-dedicated-server-portal-experience/)

Se a tela que você vê no painel não bater com esses passos (a Hivelocity
muda a UI de vez em quando), me descreve o que está aparecendo que eu
ajusto o roteiro.

## 2. Entrar no servidor e instalar o Docker

```bash
ssh root@SEU_IP_AQUI
```

Servidor limpo, então instale o Docker (script oficial):

```bash
curl -fsSL https://get.docker.com | sh
```

Confirme:
```bash
docker --version
docker compose version
```

## 3. Clonar o projeto

```bash
apt-get update && apt-get install -y git
git clone https://github.com/adminaen/aen-pad.git
cd aen-pad
```

## 4. Configurar o `.env`

```bash
cp .env.example .env
nano .env
```

Ajuste:
- `APP_PASSWORD=` → uma senha forte, só dessa instância pública.
- `APP_SECRET=` → o Node não está instalado no host (só dentro do
  container), então gere com `openssl`, que já vem no Ubuntu:
  ```bash
  openssl rand -hex 32
  ```
- `COOKIE_SECURE=1` → **importante**: liga porque agora tem HTTPS de
  verdade na frente (Caddy).
- `DOMAIN=pad.admiravelempregonovo.com.br` → o seu domínio.

## 5. Abrir as portas 80 e 443

Essas são as únicas portas que precisam ficar públicas (a 3000 do app
fica só em loopback, o Caddy é quem fala com a internet):

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Se a Hivelocity também tiver um firewall/security group no painel (além
do `ufw` do próprio Ubuntu), libere as mesmas portas lá também.

## 6. Cloudflare: apontar o domínio pro servidor

No painel do Cloudflare, na zona do seu domínio:

- Adicione um registro **A**: nome `pad`, valor = IP público do VPS.
- **Recomendo começar com a nuvem cinza (DNS only / não-proxied)**, não a
  laranja. Assim o Caddy consegue emitir o certificado Let's Encrypt sem
  nenhuma configuração extra, e testamos o básico primeiro. Depois que
  confirmar que está tudo funcionando, você pode religar o proxy
  (nuvem laranja) do Cloudflare — só lembre de mudar o **SSL/TLS mode**
  do Cloudflare pra **Full (strict)** nesse caso, senão dá loop de
  redirecionamento.

## 7. Subir o app

De volta no servidor, dentro da pasta `aen-pad`:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Acompanhe os logs (o Caddy demora uns segundos pra emitir o certificado
na primeira vez):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
```

Procure por algo como `certificate obtained successfully` nos logs.

## 8. Testar

- Abra `https://pad.admiravelempregonovo.com.br` no navegador — deve pedir a senha e
  ter o cadeado de HTTPS válido.
- Repita os testes de sempre: escrever e recarregar, duas abas (tempo
  real), `.zip`, histórico, `/_notas`, menu lateral de sub-notas.

## Manutenção

- **Atualizar o app** depois de um novo PR mergeado:
  ```bash
  cd aen-pad
  git pull origin main
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
  ```
- **Certificado HTTPS**: o Caddy renova sozinho, nada pra fazer.
- **Backup**: veja a seção "Backup" no `README.md` — ainda mais
  importante numa instância pública.
