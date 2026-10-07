# @gereh/cli

Deploy and manage [Gereh Apps](https://gereh.net/paas) from your terminal or CI. Zero dependencies, Node 20+.

```bash
npx @gereh/cli login                 # paste a read-write token from Panel › SSH و API
npx @gereh/cli link my-shop          # writes gereh.json in this folder
npx @gereh/cli deploy -m "v1.4"      # ZIP apps: packs and uploads this folder; Git/image apps: rebuild
npx @gereh/cli logs -f
npx @gereh/cli env set API_KEY=xyz --secret
```

In CI set `GEREH_TOKEN` instead of logging in. Files listed in `.gerehignore` (or, if absent, `.gitignore`) are not uploaded; `node_modules`, `.git`, `.env` and build caches never are.

Full guide (Persian): https://gereh.net/docs/paas
