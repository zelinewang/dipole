# Contributing to Dipole

Dipole is a small demo: a Node CLI agent (`agent/`) plus a Streamlit chat UI
(`demo/`). The Node side runs on built-ins (no `npm install`); the UI needs
Python.

## Setup

```bash
git clone https://github.com/zelinewang/dipole.git
cd dipole
python3 -m venv .venv && source .venv/bin/activate
pip install -r demo/requirements.txt
export FAST_DEPLOY_MOCK=success   # exercise the flow with no real deploy
```

Run the UI with `streamlit run demo/streamlit_app.py`. See `README.md` for the
OpenAI key and real-deploy tokens.

## Checks

All component validations are credential-free:

```bash
bash validation/run_validation.sh
```

This covers fixture detection, the analyzer, JSON-only CLI output, and mocked
Netlify/Vercel deploys — a superset of the JSON-only and mock-deploy checks CI
runs. It never does a live deploy.

## Pull requests

- Branch off `master`; open one focused PR per change.
- Conventional-ish commit subjects (`fix:`, `feat:`, `docs:`…). PRs are
  squash-merged.
- The CLI must keep emitting JSON-only on stdout (the UI parses it); log prose
  to stderr.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
