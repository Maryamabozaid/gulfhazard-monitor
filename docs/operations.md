# تشغيل GulfHazard Monitor

## على جهازك

1. افتحي PowerShell في المجلد اللي فيه `package.json`. احتفظي بملف `.env` الحالي لأنه فيه إعدادات المزوّدين.
2. عند فك نسخة جديدة شغّلي `npm ci` ثم `npm run build` مرة واحدة. لو دي أول مرة تشغّلي المشروع وملف الإعدادات مش موجود، استخدمي `if (!(Test-Path .env)) { Copy-Item .env.example .env }`.
3. شغّلي `npm start` وافتحي [الخريطة المحلية](http://127.0.0.1:5173). سيبي PowerShell مفتوح طول فترة التشغيل.
4. من زر **Account / الحساب** تقدري تعملي أول حساب مسؤول محلي بكلمة مرور ١٢ حرف على الأقل. من نفس الشاشة ضيفي حسابات بصلاحية مشاهدة أو تحليل أو إدارة. تصفّح الخريطة المحلية متاح قبل إنشاء الحساب، وإدارة التنبيهات محتاجة حساب.
5. افتحي **Compare**، اختاري القمر والتاريخ من كل ناحية، واسحبي الفاصل. خيار **Hazard indicators** يظهر نفس أرصاد الفلاتر على الناحيتين. اختاري **Water mask** لكشف المياه المحتملة أو **Change** على اليمين لمقارنة صور رادارية. زر **تكبير منطقة التحليل** يوصّلك للرقعة المحسوبة.

## PostgreSQL / PostGIS deployment

The local configuration stores PostgreSQL and PostGIS in `DATA_DIR/postgres` using PGlite. Run one local process against this directory. For concurrent servers, point every instance at the same PostgreSQL database through `DATABASE_URL`. This shares users, sessions, response cache, provider state, subscriptions and the delivery outbox. The database user needs permission to create the schema. An administrator can install the `postgis` extension in advance.

Docker Compose provides a PostgreSQL 17/PostGIS service with a named volume and a loopback application port. Set a strong `POSTGRES_PASSWORD` and choose `DATA_PROFILE=commercial` or `research` in the local environment file. Then run:

```sh
docker compose up -d --build
docker compose exec app node scripts/create-admin.mjs
```

Visit **http://127.0.0.1:5180**. The CLI prompts privately for the first password. Create the administrator before connecting an external reverse proxy. Configure HTTPS and `COOKIE_SECURE=true` for a TLS deployment. Bindings, backups, TLS, failover and recipient mail configuration belong to the deployment. Back up the PostgreSQL database and test restoration with the organization's retention requirements. Where possible, use separate databases for commercial and research work. Browser projects and map preferences are local to a browser profile.

The first local start imports the previous `monitor.sqlite` from `DATA_DIR` in a transaction. It preserves the old file. Legacy rules are visible to administrators. Only research installations import legacy response caches. To migrate an old deployment to external PostgreSQL, mount the directory containing its completed SQLite database, WAL and SHM into the migration process. Stop the old writer first. The migration marker prevents repeated imports. A PGlite directory and a native PostgreSQL data directory have different storage requirements.

| Role | Permissions |
| --- | --- |
| Viewer | Browse configured layers and the account's own inbox |
| Analyst | Viewer access plus creating and deleting own alert rules |
| Administrator | Manage accounts, role assignments and all alert rules |

## Monitoring and notifications

Priority layers are checked at startup and every five minutes, subject to source cache TTL. Other layers record health when queried. **Info → Provider health** shows the latest successful or failed retrieval. The header flags failed providers. The aggregate endpoint `GET /api/health/providers` returns HTTP 503 for recorded outages or overdue priority checks. An uptime monitor can alert on this endpoint. `GET /api/health` checks the API process independently. HTTP 503 is possible during startup before the first provider responses.

The server matches alert rules every five minutes. Inbox insertions and outbox jobs share a transaction. Workers claim deliveries using PostgreSQL row locks. A retried webhook carries the same `Idempotency-Key`; the receiving service must persist it to suppress repeated side effects. Email uses a stable Message-ID. Ambiguous SMTP delivery is flagged for manual review in Alerts. Email and webhook destinations belong to the operator. Test recipients on loopback were used for verification. Configure and test institutional recipients before enabling actual delivery.

## Commercial distribution

The commercial ZIP omits the GEM, EOG and Cerulean files, the research desalination derivative and research screenshots. The server excludes their restricted routes, dated captures and cache paths. The commercial flag in that ZIP caps the profiles it can run. SGS, IMF PortWatch, Smithsonian, GDACS, OpenSky and the free Open-Meteo and station services are also excluded pending applicable redistribution or service rights. The browser starts with local geography and disables Esri basemap services. The satellite viewer still supports eligible dated scientific imagery.

Maintain attribution for the remaining datasets and confirm provider service terms, quotas, third-party basemaps and any operator additions for the intended deployment. No paid data license is included. Server credentials enable access under the operator’s provider agreement. [GEM](https://doi.org/10.5281/zenodo.8409647) · [EOG](https://doi.org/10.5281/zenodo.23091822) · [SkyTruth terms](https://skytruth.org/terms-of-service/)
