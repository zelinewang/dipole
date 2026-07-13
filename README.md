# ⚡ Dipole

**A small demo of an AI agent that deploys a web project to Netlify or Vercel from a chat prompt.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/status-demo-blue)](#what-this-is-not)

Tell the agent where your project is, and it analyzes the project type, picks a deployment target, runs the deploy, and streams the logs back — with a mock mode so you can watch the whole flow without touching a real provider.

## What it demonstrates

- **A Node CLI agent** (`agent/`) that analyzes a project, decides between Netlify and Vercel, deploys via the provider CLI or API, and streams `onLog` chunks.
- **A Streamlit chat UI** (`demo/`) that drives the CLI over subprocess: `plan` → `deploy` → `diagnose` → tail logs, with structured JSON between the two layers.
- **A mock mode** (`FAST_DEPLOY_MOCK=success|fail|rate_limit`) for demoing the agent loop with no real deployment or API key.
- **A validation harness** (`validation/`) with fixture apps (static, Vite/React, Next.js) and JSON-only output checks.

## How to run

**Prerequisites:** Python 3.10+, Node.js 18+ (the Streamlit app shells out to `node agent/cli/index.js`), and an OpenAI API key.

```bash
git clone https://github.com/zelinewang/dipole.git
cd dipole

# Python UI + deps
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r demo/requirements.txt

# Configure (required)
export OPENAI_API_KEY=sk-...          # agent reasoning
export FAST_DEPLOY_MOCK=success       # optional: dry-run without a real deploy

streamlit run demo/streamlit_app.py   # opens http://localhost:8501
```

The Node CLI runs on Node built-ins (`dotenv` is loaded only if present), so there is **no `npm install`** step. For real deploys, install the provider CLI (`netlify-cli` or `vercel`) and set `NETLIFY_AUTH_TOKEN` / `VERCEL_TOKEN` — either in the environment, a root `.env`, or the in-app **Secrets** panel.

## Validate locally

Run all four credential-free component validations with one command:

```bash
bash validation/run_validation.sh
```

The script stops at the first failure and covers fixture detection, analyzer
behavior, JSON-only CLI output, and mocked Netlify/Vercel deploy flows. It does
not perform a live provider deployment.

### Typical flow

1. "My project path is `/absolute/path/to/project`" → the agent runs `plan`.
2. "Use Netlify CLI" (or Vercel) → updates the deployment preference.
3. "Deploy now" → live logs stream in; on success a URL appears and previews in an iframe.
4. "Diagnose record `<id>`" / "Tail logs for `<id>`" → inspect a past run.

## What this is not

- **Not a hosted service.** The [landing page](https://dipoler.netlify.app/) is static documentation; install and launch the working Streamlit UI on your own machine.
- **Not production-hardened.** This is a ~7-commit demo of the agent loop, not a maintained tool.
- **Not a replacement for the Netlify/Vercel CLIs** — it orchestrates them.
- **Detection-limited.** It handles the common front-end project types it can recognize (static, React/Vite, Next.js, and similar); anything unusual may need manual setup.

## Tech

Node.js agent (standard library + optional `dotenv`) · Streamlit + LangChain chat UI · OpenAI models · Netlify / Vercel deploy CLIs.

## License

[MIT](LICENSE).

## Acknowledgments

Built with [Streamlit](https://streamlit.io/), [LangChain](https://langchain.com/), and [OpenAI](https://openai.com/); deploys via [Netlify](https://netlify.com/) and [Vercel](https://vercel.com/).
