# «Сервер #1» — выделенный сервер Sunrise Bay

Сервер открыт всегда: игрокам не нужен телефон-хозяин, можно заходить в любое время с Wi-Fi или мобильного интернета.
Он пересылает сообщения игроков друг другу (до 12 человек), а время суток и погода идут по его часам — мир у всех один.

## Вариант 1: Cloudflare Workers (бесплатно, без карты)
1. Зарегистрируйтесь на https://dash.cloudflare.com и один раз откройте раздел «Workers & Pages» (там создаётся адрес вида `имя.workers.dev`).
2. My Profile → API Tokens → Create Token → шаблон «Edit Cloudflare Workers».
3. Разверните:
   ```bash
   cd server/cloudflare
   npm install
   CLOUDFLARE_API_TOKEN=ваш_токен npx wrangler deploy
   ```
   или через GitHub: добавьте секреты `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` и запустите действие «Deploy server».
4. Адрес сервера — `sunrise-bay-server.<имя>.workers.dev`. Его вписывают в игре: «СЕРВЕРЫ» → «Адрес сервера», или зашивают в `DEFAULT_SERVER_URL` в `src/net.js`.

Бесплатный тариф Cloudflare рассчитан на небольшую нагрузку (ориентир — несколько часов игры нескольких человек в день); пустой сервер ничего не тратит.

## Вариант 2: свой компьютер или VPS
```bash
cd server/node
npm install
node server.js        # порт 8080, или PORT=9000 node server.js
```
В игре адрес: `ws://IP-компьютера:8080` (в локальной сети) или ваш домен. Для доступа из интернета нужен белый IP или проброс порта.

Проверка: `https://адрес/status` показывает число игроков.
