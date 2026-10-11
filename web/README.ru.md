# Keyward в браузере

**Языки:** [English](README.md) · Русский

Браузерный клиент **одного** сервера Vaultwarden (или Bitwarden): общий интерфейс из `ui/core` работает поверх `WebBackend` (`src/backend`), который выполняет вход, хранит ключи в открытой вкладке как non-extractable `CryptoKey` и расшифровывает данные там. Сервер не получает ключ, а страница обращается только к этому серверу.

```sh
npm -w @keyward/web run dev      # http://localhost:5191
npm -w @keyward/web run build    # web/dist
npm -w @keyward/web run test     # backend tests (vitest)
npm -w @keyward/web run check    # tsc
```

## Выбор сервера

Сервер задаётся при сборке/раздаче приложения, пользователь не вводит его:

- `VITE_KEYWARD_SERVER=https://vault.example.com` во время build;
- либо переменная отсутствует — используется origin самой страницы (рекомендуемый deployment).

Значение без `https://` (кроме `http` для localhost) останавливает приложение с ошибкой конфигурации.

### Разработка против реального сервера

```sh
VITE_KEYWARD_SERVER=https://vault.example.com npm -w @keyward/web run dev
```

Dev server проксирует `/api/*` и `/identity/*` на указанный сервер, а страница обращается к собственному origin (`http://localhost:5191`), поэтому CORS не требуется — как и при deployment. Proxy подходит для self-hosted схемы (`<server>/api`, `<server>/identity`, как отдаёт Vaultwarden); облака Bitwarden используют другие API/identity hosts и через этот proxy не проксируются. Без переменной можно разрабатывать сам интерфейс, хотя вход и backend-запросы не найдут сервер.

## Кому вы доверяете

Страница — это код, который отдаёт сервер размещения. Оператор этого origin (или человек, способный заменить `web/dist`) может отдать версию, пересылающую мастер-пароль в другое место; браузер не сможет распознать подмену. **Оператор, раздающий приложение, получает такой же уровень доверия, как и веб-сервер Bitwarden:** ключи в tab защищают от чтения vault со стороны *API-сервера*, но не от изменения страницы её *сервером размещения*. Если этому оператору доверять нельзя, используйте desktop app, чей код не скачивается при каждом посещении.

## Развёртывание

Предпочтителен **отдельный origin** для приложения, например `https://keyward.example.com`, раздающий `web/dist` и проксирующий `/api` и `/identity` к Vaultwarden. Так запросы остаются same-origin (нет CORS и третьих сторон, токены идут только этому серверу), а origin не делится с другими приложениями. Вариант с путём внутри origin самого Vaultwarden тоже работает (`base: "./"`); однако другие страницы того же origin — веб-хранилище Vaultwarden, админ-панель и остальные приложения — становятся same-origin. Уязвимость в любой из них может выполнить script в этой вкладке; также разделяются storage и service workers.

Минимальная конфигурация nginx для отдельного origin:

```nginx
server {
    listen 443 ssl;
    server_name keyward.example.com;
    # ssl_certificate …; ssl_certificate_key …;

    location /api/      { proxy_pass https://vault.example.com; proxy_set_header Host vault.example.com; }
    location /identity/ { proxy_pass https://vault.example.com; proxy_set_header Host vault.example.com; }

    location / {
        root /srv/keyward/web/dist;
        try_files $uri $uri/ /index.html;
        # В nginx блок со своими add_header теряет унаследованные заголовки;
        # поэтому перечислите их все здесь.
        add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Resource-Policy "same-origin" always;
        add_header Cache-Control "no-store" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Strict-Transport-Security "max-age=63072000" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=(self), clipboard-write=(self)" always;
    }
}
```

Если приложение раздаётся по пути на origin Vaultwarden, те же заголовки задаются в `location /keyward/ { alias /srv/keyward/web/dist/; try_files $uri $uri/ /keyward/index.html; … }` рядом с его конфигурацией.

### Для чего нужны заголовки

- **CSP** ограничивает исполняемый код и сетевые назначения.
- `Cross-Origin-Opener-Policy: same-origin` не даёт открывшему/открытому окну получить handle на окно приложения.
- `Cross-Origin-Resource-Policy: same-origin` запрещает другому сайту загрузить файлы приложения внутрь своей страницы.
- `Cache-Control: no-store` не сохраняет страницу/ответы в общей или дисковой cache и помогает следующему посещению получить фиксированный release.
- `Referrer-Policy: no-referrer` не отправляет адрес приложения вместе со ссылками.
- `Permissions-Policy` оставляет только clipboard.

### На что опирается CSP

Нет inline scripts: загружается один module script со своего origin, а Argon2id выполняется в worker-файле bundle (`worker-src 'self'`); код не внедряется и не вычисляется динамически. `'wasm-unsafe-eval'` нужен KDF (Argon2id из локально bundled `hash-wasm`) и разрешает WebAssembly, не JavaScript `eval`.

В разметке нет inline styles; стили входят в bundle. Приложение не использует `data:` URI или сторонние origin. Шрифты входят в bundle (`assetsInlineLimit: 0` оставляет их отдельными файлами), иконки — inline SVG markup, а `connect-src 'self'` работает благодаря same-origin размещению. Если сборка указывает внешний `VITE_KEYWARD_SERVER`, его origin нужно добавить в `connect-src`, а сервер должен разрешить CORS. `frame-ancestors 'none'` не даёт встроить приложение во frame и атаковать поле мастер-пароля через clickjacking.

## Что хранится во вкладке

Данные сессии живут в памяти вкладки и нигде больше: tokens, всё ещё зашифрованные ключи, параметры KDF и, если отмечен «Remember this device», server remember token. Lock оставляет эти значения во вкладке, поэтому повторная разблокировка использует мастер-пароль; reload, закрытая вкладка или crash стирают их, и следующий визит требует полноценного входа, включая второй фактор. Поэтому remember token избавляет от второго фактора только при повторном входе в той же странице. `localStorage` содержит только device id — случайный UUID, не секрет и не token; без него сервер считал бы каждый вход новым устройством. Расшифрованные данные никуда не записываются.

Вкладка блокируется после 15 минут без ввода; вход, ожидающий второй фактор, отменяется через 5 минут; скопированный секрет очищается через 30 секунд. Если браузер не разрешает unfocused странице очищать clipboard, он стирается при возвращении фокуса, а пока UI сообщает, что в буфере ещё находится секрет.
