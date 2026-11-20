# Railway Infrastructure as Code

`railway.ts` is the source of truth for the build and deploy settings of the
Railway services it declares. Railway reads nothing from this repository's
`railway.json` / `railway.toml` any more (Config as Code was retired on
2026-12-01); the settings live on the service and are managed from this file.

It is a named partial: it manages only the services and volumes it declares,
never the databases or services owned by other repositories.

```bash
(cd .railway && npm ci)
railway link            # the project and environment named in railway.ts
railway config plan     # must show only the change you intend
railway config apply
```

Every variable of a declared service is listed as `preserve()` (value kept on
Railway, never in git). A variable added in the dashboard but missing here shows
up as a delete in the plan: add it to `railway.ts` before applying. Never apply
a plan that deletes a variable, volume or domain you meant to keep.
