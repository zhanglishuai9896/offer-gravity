# Deployment

This repo is split into two deployable surfaces:

## Frontend

Deploy `site/` as a static site.

```text
Framework preset: Other
Root directory: ./site
Install command: npm install
Build command: npm run build
Output directory: dist/client
```

Set this build environment variable when the backend has a public URL:

```text
VITE_API_BASE_URL=https://your-backend-domain.example
```

The build writes that value into `public/env.js`, and browser requests to
`/api/...` are sent to that backend domain.

## Backend

Deploy `server/` as a Node.js service.

```text
Root directory: ./server
Install command: npm install
Start command: npm start
```

Set backend runtime environment variables in the backend platform:

```text
PORT=4173
FRONTEND_ORIGIN=https://your-frontend-domain.example
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
```

For quick testing, `FRONTEND_ORIGIN=*` is acceptable. For production, use the
actual frontend domain.
