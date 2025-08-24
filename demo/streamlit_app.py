# -*- coding: utf-8 -*-
"""
Dipole - Deploy can be even Faster
Streamlit demo UI for AI-powered deployment automation

This app provides:
- Chat-based LangChain Agent (OpenAI) that orchestrates the Node CLI (agent/cli/index.js)
- Tools: Plan, Deploy (with near real-time logs), Diagnose, Tail Logs, Show Preview, Modify Plan
- Two-pane layout: left chat; right live logs + deployment preview with progress tracking

Features:
- AI-powered deployment decisions and automation
- Real-time progress tracking with visual stepper
- Live log streaming and download/copy functionality
- QR code sharing and mobile-friendly preview
- Support for Netlify and Vercel deployments

Env vars:
- OPENAI_API_KEY must be set.
- Optional: FAST_DEPLOY_MOCK=success|fail|rate_limit for demo without external providers.

Run:
- pip install -r demo/requirements.txt
- streamlit run demo/streamlit_app.py
"""

import os
import sys
import json
import time
import threading
import subprocess
import uuid
import io
import base64
from urllib.parse import urlparse
from pathlib import Path
from typing import Optional, Dict, Any

import streamlit as st
from streamlit_extras.stoggle import stoggle
from streamlit_extras.stylable_container import stylable_container
import qrcode
from PIL import Image
import pyperclip

# LangChain imports
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

# -------------------------------------------------------------------------------------
# Paths and configuration
# -------------------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
CLI_PATH = REPO_ROOT / "agent" / "cli" / "index.js"

if not CLI_PATH.exists():
    st.error(f"CLI not found at {CLI_PATH}. Please run this app from the repo root.")

# -------------------------------------------------------------------------------------
# Streamlit page setup (modern, clean, avoid purple; dark mode friendly)
# -------------------------------------------------------------------------------------
st.set_page_config(page_title="Fast Deploy Agent", layout="wide")

CUSTOM_CSS = """
<style>
/********* Layout and colors (avoid purple) *********/
:root {
  --bg: #0f1115;
  --panel: #161a22;
  --text: #e6e8ef;
  --muted: #a8b0c3;
  --accent: #2ec4b6; /* teal */
  --accent2: #ff7f50; /* coral */
  --success: #2dd4bf;
  --danger: #ff5a5f;
}

.stApp { background: linear-gradient(135deg, #0d0f14 0%, #0f1115 100%); }

.block-container { padding-top: 1.2rem; }

.section-title { color: var(--text); font-weight: 700; letter-spacing: .4px; }
.small { color: var(--muted); font-size: 0.9rem; }
.panel { background: rgba(22,26,34,0.85); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px 14px; }
.logbox { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color: #dde3f0; background: #0b0e13; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px; height: 360px; overflow: auto; white-space: pre-wrap; }
.urlpill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: rgba(46,196,182,0.15); border: 1px solid rgba(46,196,182,0.25); color: var(--text); font-size: 0.9rem; }
.badge { display: inline-block; padding: 3px 8px; border-radius: 6px; background: rgba(255,127,80,0.15); border: 1px solid rgba(255,127,80,0.25); color: var(--text); font-size: 0.85rem; }
</style>
"""

st.markdown(CUSTOM_CSS, unsafe_allow_html=True)

# -------------------------------------------------------------------------------------
# Helper: run CLI with streaming
# -------------------------------------------------------------------------------------

def run_cli_stream(cmd: str, env: Optional[Dict[str, str]] = None, cwd: Optional[str] = None):
    """Run a shell command and yield stdout lines in real-time.
    Returns (exit_code, full_output) after generator is fully consumed.
    """
    process = subprocess.Popen(
        cmd,
        cwd=cwd or str(REPO_ROOT),
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
        bufsize=1,
        universal_newlines=True,
    )
    full = []
    try:
        assert process.stdout is not None
        for line in iter(process.stdout.readline, ""):
            full.append(line)
            yield ("line", line)
        process.stdout.close()
        rc = process.wait()
        yield ("end", (rc, "".join(full)))
    except Exception as e:
        try:
            process.kill()
        except Exception:
            pass
        yield ("error", str(e))


def extract_last_json_block(text: str) -> Optional[Dict[str, Any]]:
    """Attempt to extract the last JSON object from a mixed stdout string.
    We search from the end for a '{' and try to json.loads increasingly large suffixes.
    """
    s = text
    for i in range(len(s) - 1, -1, -1):
        if s[i] == '{':
            candidate = s[i:]
            try:
                obj = json.loads(candidate)
                return obj
            except Exception:
                continue
    return None


def normalize_url(u: Optional[str]) -> Optional[str]:
    """Ensure a URL has an explicit scheme. Default to https:// when missing.
    Supports inputs like 'example.com', '//example.com', or full URLs.
    """
    if not u:
        return u
    s = u.strip()
    if s.startswith(("http://", "https://")):
        return s
    if s.startswith("//"):
        return "https:" + s
    return "https://" + s


def update_progress_step(step: int, status: str = "active"):
    """Update deployment progress step and status."""
    st.session_state.deploy_progress = {"step": step, "status": status}
    if status == "completed":
        st.toast(f"✅ Step {step} completed!", icon="✅")


def render_progress_stepper():
    """Render modern progress stepper for deployment flow."""
    progress = st.session_state.get("deploy_progress", {"step": 0, "status": "idle"})
    current_step = progress.get("step", 0)
    status = progress.get("status", "idle")
    
    steps = [
        {"name": "Plan", "icon": "🎯", "desc": "Analyze project"},
        {"name": "Deploy", "icon": "🚀", "desc": "Execute deployment"},
        {"name": "Verify", "icon": "✅", "desc": "Check status"},
        {"name": "Preview", "icon": "👀", "desc": "View result"}
    ]
    
    stepper_html = "<div style='display: flex; justify-content: space-between; margin: 1rem 0; padding: 1rem; background: rgba(22,26,34,0.6); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);'>"
    
    for i, step in enumerate(steps):
        step_num = i + 1
        is_active = step_num == current_step
        is_completed = step_num < current_step or (step_num == current_step and status == "completed")
        is_upcoming = step_num > current_step
        
        if is_completed:
            color = "#2dd4bf"
            bg_color = "rgba(45,212,191,0.2)"
            border_color = "#2dd4bf"
        elif is_active:
            color = "#2ec4b6"
            bg_color = "rgba(46,196,182,0.2)"
            border_color = "#2ec4b6"
        else:
            color = "#6b7280"
            bg_color = "rgba(107,114,128,0.1)"
            border_color = "#6b7280"
        
        stepper_html += f"""
        <div style='flex: 1; text-align: center; position: relative;'>
            <div style='width: 40px; height: 40px; border-radius: 50%; background: {bg_color}; border: 2px solid {border_color}; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.5rem; font-size: 1.2rem;'>
                {step['icon'] if is_completed or is_active else '⚪'}
            </div>
            <div style='color: {color}; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.2rem;'>{step['name']}</div>
            <div style='color: #a8b0c3; font-size: 0.7rem;'>{step['desc']}</div>
        </div>
        """
        
        if i < len(steps) - 1:
            line_color = "#2dd4bf" if is_completed else "#6b7280"
            stepper_html += f"<div style='flex: 0.3; height: 2px; background: {line_color}; margin-top: 20px; opacity: 0.5;'></div>"
    
    stepper_html += "</div>"
    return stepper_html


def generate_qr_code(url: str) -> str:
    """Generate QR code for URL and return as base64 image."""
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(url)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="#2ec4b6", back_color="#0f1115")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    return base64.b64encode(buffer.getvalue()).decode()

# -------------------------------------------------------------------------------------
# Tool schemas
# -------------------------------------------------------------------------------------

class PlanInput(BaseModel):
    project_path: str = Field(..., description="Absolute path to the project to plan.")
    provider: Optional[str] = Field(None, description="Optional provider override: vercel|netlify")
    method: Optional[str] = Field(None, description="Optional method override: cli|api")
    session_id: Optional[str] = Field(None, description="Session id to persist state.")


class DeployInput(BaseModel):
    project_path: str = Field(..., description="Absolute path to the project to deploy.")
    session_id: Optional[str] = Field(None, description="Session id to persist state.")
    dry_run: bool = Field(False, description="If true, perform a dry-run only.")
    yes: bool = Field(True, description="Skip interactive confirmations.")


class DiagnoseInput(BaseModel):
    project_path: Optional[str] = Field(None, description="Optional project path for context.")
    log_path: Optional[str] = Field(None, description="Path to a logs file to diagnose.")
    record_id: Optional[str] = Field(None, description="Deploy record id whose logs should be diagnosed.")


class TailLogsInput(BaseModel):
    record_id: str = Field(..., description="Deploy record id to tail logs for.")


class ModifyPlanInput(BaseModel):
    provider: Optional[str] = Field(None, description="vercel|netlify")
    method: Optional[str] = Field(None, description="cli|api")
    output_dir: Optional[str] = Field(None, description="Build output directory override.")
    domain: Optional[str] = Field(None, description="Custom domain suggestion (best-effort guidance).")


class ShowPreviewInput(BaseModel):
    url: str = Field(..., description="Deployment URL to embed.")

# -------------------------------------------------------------------------------------
# Tools (bridge LangChain -> Node CLI)
# -------------------------------------------------------------------------------------

@tool("Plan", args_schema=PlanInput)
def tool_plan(project_path: str, provider: Optional[str] = None, method: Optional[str] = None, session_id: Optional[str] = None) -> str:
    """Analyze and decide a deployment plan for the given project path. Returns JSON."""
    # Update progress to Plan step
    update_progress_step(1, "active")
    
    # Read defaults from session prefs if not explicitly provided
    prefs = st.session_state.get("prefs", {})
    provider = provider or prefs.get("provider")
    method = method or prefs.get("method")
    if not session_id:
        session_id = st.session_state.get("session_id")

    args = [
        f"node {CLI_PATH} plan --path \"{project_path}\" --json-only",
    ]
    if provider:
        args.append(f"--provider {provider}")
    if method:
        args.append(f"--method {method}")
    if session_id:
        args.append(f"--session {session_id}")
    cmd = " ".join(args)

    out_lines = []
    for kind, payload in run_cli_stream(cmd):
        if kind == "line":
            out_lines.append(payload)
        elif kind == "end":
            rc, full = payload
            try:
                data = json.loads(full)
                update_progress_step(1, "completed")  # Plan completed
                return json.dumps(data)
            except Exception:
                return full
        elif kind == "error":
            return f"Error: {payload}"
    return "{}"


@tool("Deploy", args_schema=DeployInput)
def tool_deploy(project_path: str, session_id: Optional[str] = None, dry_run: bool = False, yes: bool = True) -> str:
    """Execute deployment for the given project path. Streams logs to the UI and returns the final DeployRecord JSON."""
    # Update progress to Deploy step
    update_progress_step(2, "active")
    
    # Prepare command; do NOT use --json-only to allow live stdout logs
    prefs = st.session_state.get("prefs", {})
    if not session_id:
        session_id = st.session_state.get("session_id")
    args = [f"node {CLI_PATH} deploy --path \"{project_path}\""]
    # Apply stored provider/method preferences if any
    if prefs.get("provider"):
        args.append(f"--provider {prefs['provider']}")
    if prefs.get("method"):
        args.append(f"--method {prefs['method']}")
    if session_id:
        args.append(f"--session {session_id}")
    if dry_run:
        args.append("--dry-run")
    if yes:
        args.append("--yes --non-interactive")
    cmd = " ".join(args)

    # UI placeholders
    log_placeholder = st.session_state.get("log_placeholder") or st.empty()
    status_placeholder = st.session_state.get("status_placeholder") or st.empty()

    buffer = []
    final_json = None
    for kind, payload in run_cli_stream(cmd):
        if kind == "line":
            buffer.append(payload)
            # Store logs in session state for copy/download functionality
            st.session_state.current_logs = ''.join(buffer)
            if len(buffer) % 5 == 0:
                log_placeholder.markdown(f"""<div class='logbox'>{''.join(buffer).replace('<','&lt;')}</div>""", unsafe_allow_html=True)
        elif kind == "end":
            rc, full = payload
            # flush logs
            st.session_state.current_logs = ''.join(buffer)
            log_placeholder.markdown(f"""<div class='logbox'>{''.join(buffer).replace('<','&lt;')}</div>""", unsafe_allow_html=True)
            status = "success" if rc == 0 else "failed"
            status_placeholder.markdown(f"<span class='badge'>Deploy finished: {status}</span>", unsafe_allow_html=True)
            
            # Update progress to Verify step
            update_progress_step(3, "active")
            
            # try to parse the last JSON block
            obj = extract_last_json_block(full)
            if obj:
                final_json = obj
            break
        elif kind == "error":
            log_placeholder.markdown(f"<div class='logbox'>Error: {payload}</div>", unsafe_allow_html=True)
            break

    if final_json is None:
        return json.dumps({"type": "Error", "message": "Deploy finished but no JSON record captured."})

    # If URL available, show preview now
    url = final_json.get("url") if isinstance(final_json, dict) else None
    if url:
        st.session_state["last_deploy_url"] = normalize_url(url)
        update_progress_step(4, "completed")  # Preview step completed
    else:
        update_progress_step(3, "completed")  # Deploy completed but no URL

    return json.dumps(final_json)


@tool("Diagnose", args_schema=DiagnoseInput)
def tool_diagnose(project_path: Optional[str] = None, log_path: Optional[str] = None, record_id: Optional[str] = None) -> str:
    """Run diagnoser on a log file or a previous deployment record id. Returns JSON."""
    if not log_path and not record_id:
        return "Error: Provide either log_path or record_id."

    args = [f"node {CLI_PATH} diagnose --json-only"]
    if project_path:
        args.append(f"--path \"{project_path}\"")
    if log_path:
        args.append(f"--log \"{log_path}\"")
    if record_id:
        args.append(f"--id {record_id}")
    cmd = " ".join(args)

    collected = []
    for kind, payload in run_cli_stream(cmd):
        if kind == "line":
            collected.append(payload)
        elif kind == "end":
            rc, full = payload
            try:
                data = json.loads(full)
                return json.dumps(data)
            except Exception:
                return full
        elif kind == "error":
            return f"Error: {payload}"
    return "{}"


@tool("TailLogs", args_schema=TailLogsInput)
def tool_tail_logs(record_id: str) -> str:
    """Fetch the logs for a given record id from state/deployments.json and return the last 200 lines."""
    state_file = REPO_ROOT / "state" / "deployments.json"
    if not state_file.exists():
        return "No deployments.json found."
    try:
        data = json.loads(state_file.read_text("utf-8"))
        rec = next((r for r in data[::-1] if r.get("id") == record_id), None)
        if not rec:
            return f"No record found for id {record_id}"
        logs_path = rec.get("logsPath")
        if not logs_path or not Path(logs_path).exists():
            return f"No logs found at {logs_path}"
        content = Path(logs_path).read_text("utf-8").splitlines()[-200:]
        return "\n".join(content)
    except Exception as e:
        return f"Error: {e}"


@tool("ModifyPlan", args_schema=ModifyPlanInput)
def tool_modify_plan(provider: Optional[str] = None, method: Optional[str] = None, output_dir: Optional[str] = None, domain: Optional[str] = None) -> str:
    """Store preferred provider/method and optional output-dir/domain suggestions in session for next planning/deploy runs."""
    prefs = st.session_state.get("prefs", {})
    if provider:
        prefs["provider"] = provider
    if method:
        prefs["method"] = method
    if output_dir:
        prefs["output_dir"] = output_dir
    if domain:
        prefs["domain"] = domain
    st.session_state["prefs"] = prefs
    return json.dumps({"type": "PrefsUpdated", **prefs})


@tool("ShowPreview", args_schema=ShowPreviewInput)
def tool_show_preview(url: str) -> str:
    """Render a deployment preview iframe in the UI. Returns the URL."""
    fixed = normalize_url(url)
    st.session_state["last_deploy_url"] = fixed
    return fixed


TOOLS = [tool_plan, tool_deploy, tool_diagnose, tool_tail_logs, tool_modify_plan, tool_show_preview]

# -------------------------------------------------------------------------------------
# Agent setup (OpenAI function calling tools agent)
# -------------------------------------------------------------------------------------

SYSTEM_INSTRUCTION = """
You are an AI deployment agent for Dipole - Deploy can be even Faster.
Your goals:
1) Start by asking the user for the absolute Project Path.
2) Plan the deployment using the Plan tool. You may apply session_id if user provided one.
3) Offer to modify plan parameters (provider, method) via ModifyPlan if requested.
4) On user's confirmation, run Deploy. Stream progress in the UI (the tool handles live logs).
5) On completion, if a URL is available, call ShowPreview to display the deployed website.
6) If the user asks for investigation, call Diagnose with a provided log file or a record id.
7) Keep responses concise and action-oriented.
8) Do not ask the user to fill parameters beyond Project Path; infer or set sane defaults.
"""

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_INSTRUCTION),
    MessagesPlaceholder(variable_name="chat_history"),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad"),
])

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.2)
agent = create_openai_tools_agent(llm=llm, tools=TOOLS, prompt=prompt)
agent_executor = AgentExecutor(agent=agent, tools=TOOLS, verbose=True)

# -------------------------------------------------------------------------------------
# UI Layout
# -------------------------------------------------------------------------------------

# Modern hero section with stylable container
with stylable_container(
    key="hero_section",
    css_styles="""
    {
        background: linear-gradient(135deg, rgba(46,196,182,0.1) 0%, rgba(255,127,80,0.05) 100%);
        border: 1px solid rgba(46,196,182,0.2);
        border-radius: 16px;
        padding: 2rem;
        margin-bottom: 1.5rem;
        backdrop-filter: blur(10px);
    }
    """
):
    st.markdown(
        """
        <div style='text-align: center;'>
            <h1 style='color: #2ec4b6; font-size: 2.5rem; margin-bottom: 0.5rem; font-weight: 700;'>⚡ Dipole</h1>
            <p style='color: #a8b0c3; font-size: 1.2rem; margin-bottom: 1rem;'>Deploy can be even Faster - AI-powered deployment with real-time monitoring</p>
            <div style='display: flex; justify-content: center; gap: 1rem; flex-wrap: wrap;'>
                <span style='background: rgba(46,196,182,0.15); padding: 0.3rem 0.8rem; border-radius: 20px; font-size: 0.9rem; color: #2ec4b6;'>🤖 LangChain Agent</span>
                <span style='background: rgba(255,127,80,0.15); padding: 0.3rem 0.8rem; border-radius: 20px; font-size: 0.9rem; color: #ff7f50;'>📊 Live Logs</span>
                <span style='background: rgba(45,212,191,0.15); padding: 0.3rem 0.8rem; border-radius: 20px; font-size: 0.9rem; color: #2dd4bf;'>🚀 Instant Preview</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True
    )

# Collapsible usage guide with better styling
with stylable_container(
    key="usage_guide",
    css_styles="""
    {
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
        background: rgba(22,26,34,0.6);
    }
    """
):
    stoggle(
        "💡 Quick Start Guide",
        (
            "🎯 **Step 1:** Provide your absolute Project Path in chat\n\n"
            "⚙️ **Step 2:** Ask to switch provider/method anytime (e.g., 'Use Netlify CLI')\n\n"
            "🚀 **Step 3:** Run 'Deploy now' to start deployment; watch progress and logs\n\n"
            "👀 **Step 4:** Check Preview tab for your deployed site\n\n"
            "💡 **Tip:** If Vercel preview doesn't render, use the external link button"
        ),
    )

# Initialize session state
if "messages" not in st.session_state:
    st.session_state.messages = [
        {"role": "assistant", "content": "Hi! Please provide the absolute Project Path to deploy."}
    ]
if "prefs" not in st.session_state:
    st.session_state.prefs = {}
if "session_id" not in st.session_state:
    st.session_state.session_id = f"s-{uuid.uuid4().hex[:8]}"
if "deploy_progress" not in st.session_state:
    st.session_state.deploy_progress = {"step": 0, "status": "idle"}
if "current_logs" not in st.session_state:
    st.session_state.current_logs = ""

# Right column placeholders - expand preview area
left, right = st.columns([5, 7])
with right:
    preview_tab, logs_tab = st.tabs(["Preview", "Logs"])
    # Progress stepper (always visible at top of right column)
    st.markdown(render_progress_stepper(), unsafe_allow_html=True)
    
    with logs_tab:
        with stylable_container(
            key="logs_container",
            css_styles="""
            {
                background: rgba(22,26,34,0.4);
                border-radius: 12px;
                padding: 1rem;
                border: 1px solid rgba(255,255,255,0.08);
            }
            """
        ):
            col1, col2, col3 = st.columns([2, 1, 1])
            with col1:
                st.markdown("**📊 Live Logs**", help="Near real-time logs during Deploy tool execution")
            with col2:
                if st.button("📋 Copy", help="Copy all logs to clipboard", key="copy_logs"):
                    logs = st.session_state.get("current_logs", "")
                    if logs:
                        try:
                            pyperclip.copy(logs)
                            st.toast("Logs copied to clipboard!", icon="📋")
                        except Exception:
                            st.toast("Copy failed - logs shown below", icon="⚠️")
                    else:
                        st.toast("No logs to copy yet", icon="ℹ️")
            with col3:
                if st.button("💾 Download", help="Download logs as file", key="download_logs"):
                    logs = st.session_state.get("current_logs", "")
                    if logs:
                        st.download_button(
                            label="📄 Save .log",
                            data=logs,
                            file_name=f"deploy_{st.session_state.get('session_id', 'unknown')}.log",
                            mime="text/plain",
                            key="download_logs_btn"
                        )
            
            st.session_state["log_placeholder"] = st.empty()
            st.session_state["status_placeholder"] = st.empty()
            
            # Show session id for continuity/debug
            sid = st.session_state.get("session_id")
            if sid:
                st.markdown(f"<span class='badge'>Session: {sid}</span>", unsafe_allow_html=True)
    
    with preview_tab:
        with stylable_container(
            key="preview_container",
            css_styles="""
            {
                background: rgba(22,26,34,0.4);
                border-radius: 12px;
                padding: 1rem;
                border: 1px solid rgba(255,255,255,0.08);
            }
            """
        ):
            st.markdown("**👀 Preview**", help="Rendered after deployment returns a URL")
            st.session_state["preview_placeholder"] = st.container()

with left:
    # Chat history
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.write(msg["content"])

    # User input
    if user_query := st.chat_input("Type here to instruct the agent..."):
        st.session_state.messages.append({"role": "user", "content": user_query})
        with st.chat_message("assistant"):
            with st.spinner("Agent thinking..."):
                # Build LangChain chat history from prior messages (exclude the latest user input)
                lc_history = []
                for m in st.session_state.messages[:-1]:
                    if m.get("role") == "user":
                        lc_history.append(HumanMessage(content=m.get("content", "")))
                    elif m.get("role") == "assistant":
                        lc_history.append(AIMessage(content=m.get("content", "")))

                # Invoke the agent with proper chat history for structured tools agent
                res = agent_executor.invoke({"input": user_query, "chat_history": lc_history})
                output_text = res.get("output") if isinstance(res, dict) else str(res)
                st.write(output_text)
                st.session_state.messages.append({"role": "assistant", "content": output_text})

# Render preview if any (into the stored preview placeholder)
preview_ph = st.session_state.get("preview_placeholder")
if preview_ph:
    url = normalize_url(st.session_state.get("last_deploy_url"))
    if url:
        host = urlparse(url).hostname or ""
        
        # Header with URL and share functionality
        col1, col2, col3 = st.columns([3, 1, 1])
        with col1:
            preview_ph.markdown(
                f"<span class='urlpill'>🌐 <a href='{url}' target='_blank' rel='noopener'>{url}</a></span>",
                unsafe_allow_html=True,
            )
        with col2:
            if st.button("📱 QR Code", help="Generate QR code for easy mobile access", key="show_qr"):
                qr_b64 = generate_qr_code(url)
                st.image(f"data:image/png;base64,{qr_b64}", width=200, caption="Scan to open on mobile")
        with col3:
            if st.button("📤 Share", help="Copy URL to clipboard", key="share_url"):
                try:
                    pyperclip.copy(url)
                    st.toast("URL copied to clipboard!", icon="📤")
                except Exception:
                    st.toast(f"Copy this URL: {url}", icon="📋")
        
        # Vercel sites may send headers that block embedding (X-Frame-Options/CSP). Show hint.
        if "vercel.app" in host:
            preview_ph.info("💡 This Vercel preview might block iframe embedding due to CSP/X-Frame-Options. Use the external link or QR code if the frame stays blank.")
        
        # External link button and iframe
        preview_ph.markdown(
            f"""
<div style='margin: 1rem 0;'>
  <a href='{url}' target='_blank' rel='noopener' style='text-decoration:none;'>
    <div style='display:inline-block; padding:8px 16px; border-radius:8px; background:linear-gradient(135deg, rgba(46,196,182,0.2) 0%, rgba(255,127,80,0.1) 100%); border:1px solid rgba(46,196,182,0.3); color:#2ec4b6; font-size:0.95rem; font-weight:600; transition:all 0.2s;'>🚀 Open in New Tab</div>
  </a>
</div>
<div style='margin-top:1rem; border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,0.08);'>
  <iframe src='{url}' style='width:100%; height:420px; border:none;' loading='lazy'></iframe>
</div>
            """,
            unsafe_allow_html=True,
        )
