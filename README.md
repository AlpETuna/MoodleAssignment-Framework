# Monash Assignment Pipeline

An n8n workflow that scrapes your Moodle assignments, completes them using AI agents running inside a Docker container, and drops everything submission-ready into a folder on your Desktop.

---

## How it works

### 1. Getting assignments off Moodle

Moodle requires Monash SSO authentication followed by Duo MFA, so a simple HTTP scraper won't cut it. This pipeline uses **Playwright** to drive a real Chromium browser:

1. Navigates to `moodle.vle.monash.edu`
2. Clicks through to the Monash SSO login page
3. Enters your credentials from `.env`
4. Detects the **Duo number-matching code** displayed on screen and prints it to the terminal — you tap that number in your Duo app to approve
5. Once authenticated, scrapes the **Upcoming** timeline and **Calendar** for every assignment with a due date
6. Visits each assignment page to grab the full brief, due date, unit code, and all attached files (PDFs, zip archives, starter code)
7. Downloads everything into `workspace/{unit}/{assignment}/`

The browser runs with `headless: false` so you can see exactly what's happening, and the pipeline pauses at the Duo step until you approve.

### 2. Understanding the assignment

A **Claude claude-sonnet-4-6 Analyzer Agent** reads the brief and returns structured JSON describing what needs to be done: whether it's a coding task, a written report, or both; the programming language; whether it involves significant mathematics; what files need to be submitted; and the key marking criteria. This routes the assignment to the right agent(s).

### 3. Everything runs inside Docker

All code execution, testing, and LaTeX compilation happens inside a persistent Docker container (`assignment-runner`) so nothing touches your machine directly. The container has:

- **Python 3** + numpy, scipy, matplotlib, pandas, sympy, pytest
- **Java** (JDK + JRE)
- **C / C++** (gcc, g++, cmake)
- **Node.js 20** + Jest, Mocha
- **TeX Live** (full LaTeX distribution, pdflatex, latexmk)
- **R**, common build tools

The `workspace/` folder is mounted as a Docker volume, so files written by the AI agents on the host are immediately visible inside the container and vice versa.

### 4. Separate agents for code vs. reports

Two specialised Claude agents handle different parts of an assignment:

**Code Agent** — given the assignment brief and any starter files, it:
- Reads all files in the workspace
- Writes the implementation in the required language
- Writes tests (pytest, JUnit, Jest — whatever fits)
- Executes them inside Docker via `docker exec`
- Iterates until all tests pass
- Falls back to SymPy or Mathematica MCP for any mathematical computation

**Report Agent** — given the brief and any code outputs, it:
- Writes a complete LaTeX document using the Monash report template
- Fills in all sections required by the marking rubric
- Formats equations, tables, and figures in proper LaTeX
- Compiles to PDF using `pdflatex` inside Docker
- Fixes any compilation errors and recompiles until the PDF builds cleanly

For assignments that need both (e.g. implement an algorithm and write a report analysing it), the Code Agent runs first and the Report Agent reads its outputs.

### 5. Math via Mathematica MCP

If the assignment involves symbolic mathematics, the agents call a **Mathematica MCP server** (if you have one running locally). If not, SymPy inside the Docker container is used as a fallback. Either way, results can be exported directly as LaTeX for inclusion in the report.

### 6. Submission packaging

Once both agents finish, the pipeline creates a structured folder at:

```
Desktop/Monash/Assignments/{UNIT}_{ASSIGNMENT_NAME}/
├── scaffold/      ← original brief and any starter files from Moodle
├── src/           ← all source code produced by the Code Agent
└── submission/    ← final files ready to upload (PDF, zip, etc.)
```

A `README.md` inside lists exactly which files to submit.

---

## Setup

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://nodejs.org/)
- An [Anthropic API key](https://console.anthropic.com/)
- [n8n](https://n8n.io/) (handled by Docker Compose below)

### Install

```powershell
# Clone / download this repo, then:
PowerShell -ExecutionPolicy Bypass -File setup.ps1
```

This will install Playwright + Chromium, build the Docker image (takes ~10 min first time due to LaTeX), and create the output directory.

### Configure

```powershell
copy .env.example .env
notepad .env
```

Fill in:

```env
MOODLE_USERNAME=your.name@student.monash.edu
MOODLE_PASSWORD=yourPassword
ANTHROPIC_API_KEY=sk-ant-...
```

### Start

```powershell
cd docker
docker compose up -d
```

Then open **http://localhost:5678** (n8n).

### Import the workflow

1. n8n → **Workflows** → **Import from File** → select `workflow.json`
2. Go to **Settings → Credentials → Add** → choose **Anthropic API** → paste your key
3. Open the workflow, find every node that says `REPLACE_WITH_ANTHROPIC_CRED_ID` and update it to your new credential
4. Click **Execute Workflow**

---

## Running the pipeline

When you click Execute:

1. A Chromium window opens and navigates to Moodle
2. The terminal (n8n execution log) prints something like:

```
==================================================
   DUO MFA — Enter this number in the Duo app:

               [ 47 ]

==================================================
```

3. Open Duo on your phone, tap **47**, approve
4. Press **Enter** in the terminal
5. The pipeline scrapes, downloads, and processes every upcoming assignment
6. Check `Desktop/Monash/Assignments/` when it finishes

---

## Project structure

```
AssigmentDoingPipeline/
├── workflow.json                  n8n pipeline (import this)
├── .env.example                   credentials template
├── setup.ps1                      one-time Windows setup
│
├── playwright/
│   └── moodle-scraper.js          Moodle auth + scraping (Playwright)
│
├── docker/
│   ├── Dockerfile                 assignment runner image
│   ├── docker-compose.yml         runner + n8n
│   └── scripts/run-tests.sh       auto-detect language + run tests
│
├── agents/
│   ├── prompts/                   system prompts for each agent
│   └── tools/                     docker-executor, file-manager, math-mcp
│
├── templates/
│   └── monash-assignment.tex      LaTeX report template
│
└── scripts/
    └── package-submission.js      builds the Desktop output folder
```

---

## Mathematica MCP (optional)

If you have Wolfram Mathematica installed and want to use it for symbolic computation instead of SymPy, start a local MCP server and set:

```env
MATHEMATICA_MCP_URL=http://localhost:8080
```

The agents will prefer Mathematica when available and fall back to SymPy automatically.

---

## Troubleshooting

**Duo code not detected automatically** — the script falls back to prompting you to approve manually and press Enter. This happens if Monash updates the Duo page layout.

**Docker build fails** — make sure Docker Desktop is running and you have ~5 GB free disk space (LaTeX is large).

**n8n can't reach the Docker container** — both services share the `assignment-net` Docker network defined in `docker-compose.yml`. Make sure you started both with `docker compose up -d` from the `docker/` folder.

**LaTeX compile errors** — the Report Agent reads the pdflatex output and iterates to fix errors. If it gets stuck, check `workspace/{unit}/{assignment}/report.tex` and compile manually with `pdflatex` to see the full error.
