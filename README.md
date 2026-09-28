# AEN Pad

Clone do [dontpad.com](https://dontpad.com) para uso pessoal: a URL é a
identidade da nota, não existe conta de usuário, o texto salva sozinho
enquanto você digita. Diferenças em relação ao original:

- **Sincronização em tempo real de verdade** via WebSocket (o dontpad
  original usa *polling* HTTP a cada 100ms/5s).
- **Uma senha única** (variável de ambiente) protege todas as notas —
  o original é público para quem souber a URL.
- **Histórico de versões** por nota, com restauração.
- **`/_notas`** lista todas as notas já criadas.
- **Menu lateral de sub-notas** — notas do tipo `pai/filho` aparecem
  listadas quando você abre a nota `pai`, com link pra voltar.
- **Preview de Markdown** — o botão "visualizar" no rodapé renderiza o
  texto (títulos, **negrito**, listas, checklist, código, tabelas). O
  que fica salvo é sempre o Markdown puro; o preview é só uma forma de
  ver, não muda o formato do arquivo.
- **Download em `.zip`** de qualquer nota, como no original.

## Rodando localmente

```bash
cp .env.example .env   # edite APP_PASSWORD e APP_SECRET
npm install
npm start
```

Abra `http://localhost:3000/qualquer-nome` — a nota é criada na hora.

## Rodando com Docker

```bash
cp .env.example .env   # edite APP_PASSWORD e APP_SECRET
docker compose up --build -d
```

Os dados ficam no volume nomeado `aen-pad-data` (arquivo SQLite em
`/data/notes.db` dentro do container), então sobrevivem a rebuilds e
restarts.

## Como funciona

- `path` da URL = chave da nota (tabela `notes` no SQLite).
- Editar → debounce de 600ms → salva via WebSocket (`/ws?path=...`).
- Concorrência otimista: se a nota foi alterada em outro lugar enquanto
  você editava, o servidor recusa o save e o front pergunta se quer
  sobrescrever — igual ao mecanismo do dontpad original.
- Cada save grava uma linha em `note_versions`, usada pelo painel de
  histórico (`histórico` no rodapé de cada nota).
- Autenticação: uma senha (`APP_PASSWORD`) protege o app inteiro via
  cookie de sessão assinado (HMAC com `APP_SECRET`) — não há contas
  individuais.

## Variáveis de ambiente

Veja `.env.example`. Em produção atrás de HTTPS, defina `COOKIE_SECURE=1`.

## Backup

Snapshot seguro do banco (usa o `.backup()` do SQLite — funciona com o
app rodando, sem risco de pegar o arquivo "no meio de uma escrita").

**Local (`npm start`):**
```bash
npm run backup
```
Salva em `backups/notes-<timestamp>.db`. Mantém só os últimos
`BACKUP_KEEP_DAYS` dias (padrão 14, ajustável no `.env`) — backups mais
antigos são apagados automaticamente a cada execução.

**Docker:** o comando roda dentro do container, mas o arquivo aparece em
`./backups` no host (já mapeado no `docker-compose.yml`):
```bash
docker compose exec aen-pad npm run backup
```
(com o overlay de produção: troque `docker compose` por
`docker compose -f docker-compose.yml -f docker-compose.prod.yml`)

**Automatizar com cron** (recomendado em produção) — no host, `crontab -e`
e adicione uma linha, por exemplo todo dia às 3h:
```
0 3 * * * cd /caminho/do/projeto && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T aen-pad npm run backup >> /var/log/dontpad-backup.log 2>&1
```
(o `-T` desliga alocação de terminal, necessário rodando via cron)

**Restaurar** um backup: pare o app, troque o `notes.db` do volume pelo
arquivo de backup, suba de novo:
```bash
docker compose stop aen-pad
docker volume ls | grep aen-pad-data   # confirma o nome exato do volume
docker run --rm -v NOME_DO_VOLUME:/data -v $(pwd)/backups:/backups alpine \
  cp /backups/notes-TIMESTAMP.db /data/notes.db
docker compose start aen-pad
```

**Importante:** isso ainda é backup *local* — fica no mesmo disco do
servidor. Se o servidor falhar, o backup falha com ele. Pra proteção de
verdade, copie o conteúdo de `backups/` pra outro lugar periodicamente
(outro servidor via `rsync`, ou um serviço como S3/Backblaze B2/Google
Drive via `rclone`). Não automatizei essa parte porque depende de qual
serviço externo você prefere e das credenciais dele.

## Mais uma instância / publicar na internet

- Quer rodar uma segunda instância isolada (ex.: uma pessoal e outra da
  empresa)? Veja `DEPLOYING-SECOND-INSTANCE.md`.
- Quer publicar numa VPS com domínio e HTTPS automático? Veja
  `DEPLOYING-PUBLIC.md`.
