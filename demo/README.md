# Fast Deploy – Streamlit + LangChain Demo

This demo provides a chat-first AI agent UI that orchestrates the Node-based CLI (`agent/cli/index.js`).
It demonstrates:

- Chat box to instruct the agent (ask for Project Path, plan, deploy, diagnose)
- Live deploy logs streaming in the UI
- In-session preference updates ("ModifyPlan") beyond chat-lite (provider/method)
- Automatic preview of the deployed URL (embedded iframe when allowed)

All code and comments are in English by design; explanations and documentation are here.

## Requirements

- Python 3.10+
- Node.js 18+
- OpenAI API key (set `OPENAI_API_KEY` in your environment)
- Optional: `FAST_DEPLOY_MOCK=success|fail|rate_limit` to simulate deployments without calling providers

## Install

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r demo/requirements.txt
```

## Run

```bash
export OPENAI_API_KEY=sk-...               # required
export FAST_DEPLOY_MOCK=success            # optional for demo
streamlit run demo/streamlit_app.py
```

## How it works

- The Streamlit app calls LangChain's tools, which bridge to our Node CLI via subprocess:
  - `Plan` -> `node agent/cli/index.js plan --json-only` (returns structured JSON)
  - `Deploy` -> `node agent/cli/index.js deploy` (no `--json-only` so stdout is streamed). Finally, the last JSON block (`DeployRecord`) is parsed and shown.
  - `Diagnose` -> `node agent/cli/index.js diagnose --json-only --log <path>|--id <recordId>`
  - `TailLogs` -> reads `state/deployments.json` and returns the last 200 lines of the referenced `logsPath`
  - `ModifyPlan` -> stores provider/method and small hints in session; subsequent Plan/Deploy apply these preferences as CLI flags
  - `ShowPreview` -> renders the returned deployment URL in an iframe

- The CLI already supports live log streaming: during `deploy`, the deployer adapters send `onLog` chunks; the CLI writes to `state/logs/<id>.log` and stdout. The demo displays stdout lines as they arrive.

## Demo flow (suggested)

1) Start the app and type: "My project path is /absolute/path/to/project".
2) The agent runs `Plan`. It may ask follow-ups; you can say "Use Netlify CLI" or "Use Vercel CLI" to update preferences.
3) Say: "Deploy now". Watch live logs in the right panel.
4) On success, a URL appears and the preview iframe renders the site.
5) Optionally: "Diagnose record <id>" or "Tail logs for <id>".

## Notes

- This demo focuses on UI/agent integration; destructive `undeploy` is deferred post-demo.
- For real provider calls, set `NETLIFY_AUTH_TOKEN` or `VERCEL_TOKEN` in `.env` (root) or project .env per CLI rules. Otherwise, use `FAST_DEPLOY_MOCK` for stable showcases.
- The app avoids purple tones and uses a modern dark theme.
