# BELIMO | Collia

Building Management System (BMS) configuration, data integration, and Knowledge Graph intelligence platform.

---

## Architecture Overview

- **Backend**: Python, FastAPI, Uvicorn
- **Frontend**: HTML5, Tailwind CSS, Vanilla JavaScript (based on the Google Stitch export)
- **Data Engine**: Pandas (for Belimo CSV processing)
- **Graph & Reasoning**: NetworkX, RDFLib, PyVis, pySHACL
- **Anomaly Detection**: Configurable Python rule engine
- **Chatbot (Future)**: Offline local LLM via Ollama

---

## Project Structure

```
Collia/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI application entrypoint
│   │   ├── api/                        # REST API routers
│   │   ├── models/                     # Internal domain models
│   │   ├── schemas/                    # Pydantic schemas
│   │   ├── services/                   # Business logic
│   │   ├── csv_processing/             # CSV readers & parameter parsers
│   │   ├── knowledge_graph/            # Graph builder & RDFLib integration
│   │   ├── anomaly_detection/          # Rule-based anomaly engine
│   │   └── chatbot/                    # Offline Ollama client
│   └── requirements.txt
├── frontend/
│   ├── original/
│   │   └── index.html                  # Backup of original Google Stitch export
│   ├── templates/
│   │   └── index.html                  # Active Jinja2 interface
│   └── static/
│       ├── css/
│       ├── js/
│       └── assets/
├── data/
│   ├── csv/                            # Source Belimo CSV drop folder
│   ├── configuration/                  # Persistent CSV configuration tables
│   ├── processed/                      # Extracted parameter tables
│   └── graph/                          # Generated graph artifacts & visualizations
├── tests/                              # Automated test suites
├── docs/                               # Documentation
├── index.html                          # Root original interface reference
├── prompt.txt                          # Master development specification
├── .gitignore
└── README.md
```

---

## Getting Started

### 1. Requirements

- Python 3.10+ (tested on Python 3.13)
- `pip install -r backend/requirements.txt`

### 2. Running the Server

From the project root:

```bash
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Open your browser and navigate to:
**`http://127.0.0.1:8000`**

### 3. API Health Check

```bash
curl http://127.0.0.1:8000/api/health
```

### 4. Running Tests

```bash
python -m unittest discover -s tests
```
