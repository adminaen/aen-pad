# Rodando uma segunda instância (ex.: empresa)

Este app não tem multi-tenant embutido: cada instância é um processo (ou
container) isolado, com seu próprio `.env` e seu próprio banco SQLite. Pra
ter uma instância "da empresa" separada da pessoal, você roda **uma segunda
cópia** do mesmo código, com configuração própria. Nenhuma mudança de
código é necessária — só configuração.

## Checklist

### 1. Decida onde o código vai morar

- **Clonar o mesmo repositório** (`adminaen/aen-pad`) — mais rápido, mas
  cria uma dependência: se um dia o acesso da empresa a este repositório
  pessoal for revogado, a instância da empresa perde a fonte de
  atualizações.
- **Fazer um fork/cópia para um repositório da própria empresa** —
  recomendado se a instância da empresa for evoluir de forma independente
  (features diferentes, outro time mexendo no código) ou se a conta da
  empresa não tem acesso ao repositório pessoal.

### 2. Clone/copie o código no ambiente da empresa

```bash
git clone https://github.com/adminaen/aen-pad.git aen-pad-empresa
cd aen-pad-empresa
cp .env.example .env
```

### 3. Gere credenciais **novas e diferentes** da instância pessoal

Nunca reutilize o `APP_PASSWORD` ou o `APP_SECRET` da instância pessoal.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edite o `.env`:
- `APP_PASSWORD=` → senha nova, só da empresa.
- `APP_SECRET=` → cole o valor gerado acima.

### 4. Se for rodar no mesmo computador/servidor da instância pessoal

As duas instâncias **não podem** dividir porta nem dados. Ajuste no `.env`
da instância da empresa:

- `PORT=3001` (ou outra porta livre — a pessoal já usa `3000`).

E, se for Docker, edite o `docker-compose.yml` **dessa cópia** pra usar
nomes diferentes de serviço/volume/porta, por exemplo:

```yaml
services:
  aen-pad-empresa:              # nome do serviço, era "aen-pad"
    build: .
    ports:
      - "3001:3000"              # porta externa diferente
    environment:
      PORT: 3000
      APP_PASSWORD: ${APP_PASSWORD:?defina APP_PASSWORD no .env}
      APP_SECRET: ${APP_SECRET:?defina APP_SECRET no .env}
      DATA_DIR: /data
      COOKIE_SECURE: ${COOKIE_SECURE:-0}
    volumes:
      - aen-pad-empresa-data:/data   # nome de volume diferente
    restart: unless-stopped

volumes:
  aen-pad-empresa-data:            # nome diferente do "aen-pad-data" pessoal
```

Se for rodar em **servidores/máquinas diferentes**, isso não é necessário
— cada um já tem sua própria porta 3000 e seu próprio disco.

### 5. Suba a instância

```bash
npm install && npm start
```
ou
```bash
docker compose up --build -d
```

### 6. Verifique que as duas instâncias estão isoladas

- Escreva uma nota na instância da empresa (`http://localhost:3001` ou o
  domínio configurado) e confirme que ela **não aparece** em `/_notas` da
  instância pessoal, e vice-versa.
- Confirme que a senha de uma instância não abre a outra.

## Antes de usar isso "pra empresa" de verdade, pense em:

- **Uma senha só para todo mundo.** Não existe conta por usuário — é o
  mesmo modelo do dontpad original, só que com uma senha extra na frente.
  Serve bem para uso individual ou um time pequeno de confiança
  compartilhando a mesma senha; não dá rastreabilidade de quem editou o
  quê.
- **Backup.** Veja a seção "Backup" no `README.md` — vale ainda mais numa
  instância de trabalho.
- **HTTPS.** Se for expor essa instância na internet (não só na rede
  interna), coloque atrás de um proxy com TLS (nginx, Caddy, Cloudflare
  Tunnel etc.) e defina `COOKIE_SECURE=1` no `.env`.
