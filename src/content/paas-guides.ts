/* /docs/paas/<guide> bodies (same Markdown subset as /docs/paas): CI/CD, Docker deploys and the
   multi-service template format. */
export type PaasGuide = { slug: string; title: string; lead: string; description: string; icon: string; body: string };

const CI = `گره اپ را می‌توان از هر سیستم CI/CD با [CLI](/docs/paas) یا [API عمومی](/docs/api) مستقر کرد. فقط یک توکن خواندن-نوشتن لازم است که در [پنل › SSH و API](/panel/keys) می‌سازید و به‌عنوان secret با نام \`GEREH_TOKEN\` در مخزن ذخیره می‌کنید.

## سه روش استقرار

| روش | مناسب برای | دستور |
|---|---|---|
| بیلد در گره | اپ‌های Git و ZIP | \`gereh deploy\` |
| ایمیج آماده | وقتی CI خودش ایمیج می‌سازد | \`gereh deploy --image ghcr.io/acme/api:SHA\` |
| Webhook | push ساده بدون CI | نشانی Webhook تب «تنظیمات» |

## GitHub Actions

### بیلد روی گره (ZIP یا Git)

\`\`\`yaml
name: deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx @gereh/cli deploy --app my-shop -m "$GITHUB_SHA"
        env: { GEREH_TOKEN: \${{ secrets.GEREH_TOKEN }} }
\`\`\`

### ساخت ایمیج در CI و استقرار آن

اپ را با منبع «ایمیج Docker» بسازید، سپس:

\`\`\`yaml
name: release
on: { push: { tags: ["v*"] } }
jobs:
  image:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: \${{ github.actor }}, password: \${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with: { push: true, tags: "ghcr.io/\${{ github.repository }}:\${{ github.ref_name }}" }
      - run: npx @gereh/cli deploy --app my-api --image ghcr.io/\${{ github.repository }}:\${{ github.ref_name }}
        env: { GEREH_TOKEN: \${{ secrets.GEREH_TOKEN }} }
\`\`\`

ایمیج باید عمومی باشد. CLI ایمیج جدید را روی اپ تنظیم می‌کند و تا فعال شدن نسخه جدید لاگ استقرار را نشان می‌دهد؛ اگر health check شکست بخورد، دستور با کد خطا تمام می‌شود و نسخه قبلی سرویس می‌دهد.

### پیش‌نمایش برای Pull Request

\`\`\`yaml
on: pull_request
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @gereh/cli deploy --app my-shop --preview --branch "$GITHUB_HEAD_REF"
        env: { GEREH_TOKEN: \${{ secrets.GEREH_TOKEN }} }
\`\`\`

## GitLab CI

متغیر \`GEREH_TOKEN\` را در Settings › CI/CD › Variables با گزینه Masked بگذارید.

\`\`\`yaml
stages: [deploy]
deploy:
  stage: deploy
  image: node:22-alpine
  rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }]
  script:
    - npx @gereh/cli deploy --app my-shop -m "$CI_COMMIT_SHORT_SHA"
\`\`\`

با رجیستری GitLab:

\`\`\`yaml
stages: [build, deploy]
build:
  stage: build
  image: docker:27
  services: [docker:27-dind]
  script:
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
deploy:
  stage: deploy
  image: node:22-alpine
  script:
    - npx @gereh/cli deploy --app my-api --image "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
\`\`\`

رجیستری پروژه باید عمومی باشد (Settings › General › Visibility › Container registry).

## نکته‌ها

- \`--no-cache\` بیلد را بدون کش لایه‌ها انجام می‌دهد (وقتی وابستگی‌ها عوض شده‌اند ولی lockfile نه).
- \`--detach\` منتظر پایان استقرار نمی‌ماند.
- برای چند حساب (مثلاً staging و production) از پروفایل استفاده کنید: \`gereh --profile staging deploy\`.
- متغیرهای محیطی را از فایل وارد کنید: \`gereh env import .env.production --secret\`.
- برای اجرای migration پس از استقرار، «دستور انتشار» را در \`gereh.json\` بنویسید تا پیش از ترافیک گرفتن نسخه جدید اجرا شود.
`;

const DOCKER = `هر چیزی که در Docker اجرا می‌شود در گره اپ هم اجرا می‌شود. سه راه دارید:

## ۱. Dockerfile داخل پروژه

اگر در ریشه پروژه (یا پوشه ریشه‌ای که تعیین کرده‌اید) \`Dockerfile\` باشد، گره اپ همان را بیلد می‌کند و تشخیص خودکار کنار گذاشته می‌شود. مسیر دیگری را در تب «بیلد و اجرا» تنظیم کنید (مثلاً \`docker/prod.Dockerfile\`). آرگومان‌های بیلد (\`ARG\`) را هم همان‌جا بدهید.

\`\`\`dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000
CMD ["node", "server.js"]
\`\`\`

- اپ باید روی \`0.0.0.0\` و پورتی که در تنظیمات اپ آمده گوش دهد؛ متغیر \`PORT\` همیشه مقدار آن را دارد.
- بسته‌های npm، PyPI و Go و ایمیج‌های پایه هنگام بیلد از [میرور گره](/mirror) گرفته می‌شوند؛ \`ARG NPM_CONFIG_REGISTRY\` و \`ARG PIP_INDEX_URL\` را در Dockerfile بنویسید تا از آن استفاده شود.
- \`.dockerignore\` رعایت می‌شود؛ \`node_modules\` و \`.git\` را در آن بگذارید.

## ۲. ایمیج آماده از رجیستری

در «اپ جدید» منبع «ایمیج Docker» را انتخاب کنید و نام کامل ایمیج را بنویسید، مثل \`ghcr.io/acme/api:1.4.2\`. ایمیج باید عمومی باشد. برای انتشار نسخه جدید:

\`\`\`bash
gereh deploy --app my-api --image ghcr.io/acme/api:1.4.3
\`\`\`

برای ده‌ها نرم‌افزار متن‌باز (n8n، Nextcloud، Keycloak، Metabase…) از [اپ‌های آماده](/panel/apps/templates) استفاده کنید؛ دیسک، پایگاه داده و رمزها خودکار ساخته می‌شوند و نسخه را خودتان انتخاب می‌کنید.

## ۳. Docker Compose

ZIP پروژه‌ای که \`docker-compose.yml\` دارد را بارگذاری کنید (حداکثر ۸ سرویس). سرویس عمومی اولین سرویس دارای \`ports\` است یا برچسب \`gereh.public: "true"\` دارد. \`volumes\` و \`env_file\` نادیده گرفته می‌شوند. اگر سرویس‌های postgres، mysql یا redis دارید، بهتر است با [قالب ترکیبی](/docs/paas/stack-templates) آن‌ها را به پایگاه داده مدیریت‌شده با پشتیبان روزانه تبدیل کنید؛ ویرایشگر قالب، فایل compose را خودکار تبدیل می‌کند.

## نسخه زبان بدون Dockerfile

بدون Dockerfile هم نسخه زبان را انتخاب کنید: Node.js از 8 تا 24، PHP از 7.2 تا 8.4، Python از 3.7 تا 3.13، ‎.NET از 2.1 تا 10، Go از 1.21 تا 1.25 و… نسخه‌هایی که Nixpacks پشتیبانی می‌کند با همان ساخته می‌شوند و بقیه از ایمیج رسمی زبان (مثل \`node:8-slim\` یا \`mcr.microsoft.com/dotnet/sdk:2.1\`) با Dockerfile تولیدشده. نسخه در آرگومان بیلد \`GEREH_RUNTIME_VERSION\` نگه داشته می‌شود و از تب «بیلد و اجرا» قابل تغییر است.

## اشکال‌زدایی

\`\`\`bash
gereh logs --follow          # لاگ زنده همه نمونه‌ها
gereh shell                  # اجرای دستور در نمونه در حال اجرا
gereh deploy --no-cache      # بیلد دوباره بدون کش
\`\`\`
`;

const STACK = `«قالب ترکیبی» یک فایل YAML است که چند اپ و پایگاه داده مدیریت‌شده را با هم می‌سازد و به هم وصل می‌کند؛ مثل docker-compose، ولی با پایگاه داده‌های پشتیبان‌دار، دیسک دائمی و رمزهای تولیدشده. از [پنل › اپ‌های آماده › قالب ترکیبی](/panel/apps/stack) یکی از نمونه‌های گالری را بردارید یا قالب خودتان را بنویسید.

## نمونه

\`\`\`yaml
name: docmost
databases:
  - { id: main, engine: postgres, version: "16" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    image: docmost/docmost:0.96.0
    port: 3000
    plan: app-small
    disk: { size: 5, mount: /app/data/storage }
    env:
      APP_URL: $APP_URL
      APP_SECRET: $RANDOM_STRING
      DATABASE_URL: $DB_main_URL
      REDIS_URL: $DB_cache_URL
\`\`\`

## پایگاه‌های داده

| کلید | توضیح |
|---|---|
| \`id\` | شناسه کوتاه (حرف کوچک و عدد، حداکثر ۱۶)؛ در متغیرها استفاده می‌شود |
| \`engine\` | هر موتور مدیریت‌شده: postgres، mysql، mariadb، mongodb، redis، clickhouse… |
| \`version\` | یکی از نسخه‌های همان موتور (خالی = جدیدترین) |
| \`plan\` | پلن پایگاه داده (پیش‌فرض db-micro) |

نام هر پایگاه داده «نام پایه-id» است، مثل \`wiki-main\`.

## اپ‌ها

| کلید | توضیح |
|---|---|
| \`name\` | اپ اول \`$APP_NAME\` است (آدرس اصلی)؛ بقیه \`$APP_NAME-پسوند\`، مثل \`$APP_NAME-worker\` |
| \`image\` | ایمیج عمومی؛ یا به جای آن \`git: { url, branch }\` |
| \`stack\` و \`version\` | برای اپ‌های Git: پشته (laravel، nextjs…) و نسخه زبان |
| \`port\` | پورتی که اپ روی آن گوش می‌دهد |
| \`plan\`، \`instances\` | پلن اپ و تعداد نمونه |
| \`start\`، \`build\` | دستور اجرا (جایگزین entrypoint ایمیج) و دستور بیلد |
| \`health\` | مسیر سلامت، مثل \`/healthz\` |
| \`disk\` | \`{ size: 5, mount: /data }\` دیسک دائمی (فقط با یک نمونه) |
| \`env\` | متغیرهای محیطی |

حداکثر ۶ اپ و ۴ پایگاه داده در هر قالب. anchorهای YAML (\`&env\` و \`*env\`) برای مشترک کردن متغیرها بین وب و worker پشتیبانی می‌شوند.

## متغیرها

| متغیر | مقدار |
|---|---|
| \`$APP_NAME\` | نام پایه‌ای که هنگام ساخت وارد می‌کنید |
| \`$APP_URL\`، \`$APP_HOST\` | نشانی HTTPS و نام میزبان اپ اول |
| \`$RANDOM_STRING\` | رشته تصادفی ۶۴ نویسه‌ای، در هر استفاده جدید |
| \`$RANDOM_STRING_برچسب\` | یک مقدار تصادفی مشترک برای همه استفاده‌های همان برچسب (مثلاً کلید رمزنگاری مشترک وب و worker) |
| \`$RANDOM_HEX\`، \`$RANDOM_BASE64\` | ۳۲ رقم هگز، یا ۳۲ بایت تصادفی به base64 (مثل APP_KEY لاراول)؛ با \`_برچسب\` مشترک می‌شوند |
| \`$DB_<id>_URL\` | نشانی اتصال پایگاه داده (postgresql://…، redis://…) |
| \`$DB_<id>_HOST\`، \`_PORT\`، \`_USER\`، \`_PASSWORD\`، \`_NAME\` | اجزای اتصال، برای ایمیج‌هایی که نشانی کامل نمی‌پذیرند |

متغیرهای \`$DB_…\` باید کل مقدار باشند. این متغیرها به‌صورت «اتصال» ذخیره می‌شوند، نه مقدار ثابت؛ پس با عوض شدن رمز پایگاه داده، اپ‌ها مقدار جدید را می‌گیرند.

## تبدیل docker-compose

در ویرایشگر «از docker-compose» را بزنید و فایل را بچسبانید. سرویس‌های postgres، mysql، mariadb، mongo و redis به پایگاه داده مدیریت‌شده، اولین سرویس دارای ports به اپ اصلی، اولین volume هر سرویس به دیسک دائمی و نشانی‌هایی مثل \`postgres://user:pass@db:5432/app\` به \`$DB_db_URL\` تبدیل می‌شوند. سرویس‌های \`build\` را با \`git:\` جایگزین کنید.

## هزینه

هزینه قالب، جمع هزینه اپ‌ها و پایگاه‌های داده آن است و پیش از ساخت در ویرایشگر نمایش داده می‌شود. هر منبع جداگانه در پنل مدیریت و حذف می‌شود.
`;

export const PAAS_GUIDES: PaasGuide[] = [
  { slug: "ci-cd", title: "CI/CD با گره اپ", lead: "استقرار خودکار از GitHub Actions و GitLab CI، با بیلد روی گره یا ایمیج آماده.", description: "راهنمای استقرار خودکار روی گره اپ از GitHub Actions و GitLab CI: توکن، CLI، ایمیج آماده، پیش‌نمایش Pull Request و پروفایل‌ها.", icon: "workflow", body: CI },
  { slug: "docker", title: "استقرار با Docker", lead: "Dockerfile، ایمیج آماده، Docker Compose و انتخاب نسخه زبان.", description: "استقرار اپ با Dockerfile، ایمیج آماده Docker یا docker-compose روی گره اپ؛ میرور ایمیج‌ها و انتخاب نسخه Node.js، PHP، Python و ‎.NET.", icon: "box", body: DOCKER },
  { slug: "stack-templates", title: "قالب ترکیبی", lead: "چند اپ و پایگاه داده با یک فایل YAML؛ متغیرها، اتصال‌ها و تبدیل docker-compose.", description: "مرجع قالب ترکیبی گره اپ: ساخت هم‌زمان چند اپ و پایگاه داده با YAML، متغیرهای $APP_NAME، $RANDOM_STRING و $DB_<id>_URL و تبدیل docker-compose.", icon: "layers", body: STACK },
];
export const guideOf = (slug: string) => PAAS_GUIDES.find((g) => g.slug === slug);
