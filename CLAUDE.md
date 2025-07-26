# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development Setup

```bash
# Install dependencies using uv
uv pip install -r pyproject.toml

# Install dev dependencies (includes ruff and mypy)
uv pip install -e ".[dev]"

# Run the LangGraph server locally (opens Studio UI)
uvx --refresh --from "langgraph-cli[inmem]" --with-editable . --python 3.11 langgraph dev --allow-blocking
```

### Code Quality

```bash
# Run ruff linter
ruff check .

# Run ruff with auto-fix
ruff check --fix .

# Run type checking with mypy
mypy src/

# Run tests
pytest tests/
```

### Evaluation

```bash
# Run comprehensive evaluation on LangSmith datasets
python tests/run_evaluate.py

# Run legacy test for specific agent
python src/legacy/tests/run_test.py --agent multi_agent
python src/legacy/tests/run_test.py --agent graph
```

## Architecture Overview

Open Deep Research is a LangGraph-based deep research agent system with multiple implementations:

### Core Implementation (`src/open_deep_research/`)

-   **deep_researcher.py**: Main graph builder implementing supervisor-researcher architecture
-   **state.py**: State definitions (AgentState, SupervisorState, ResearcherState)
-   **configuration.py**: Configurable settings for models, search APIs, and behavior
-   **prompts.py**: All system prompts for research, compression, and report generation
-   **utils.py**: Helper functions for token management, tool handling, and API keys

### Key Architectural Patterns

1. **Supervisor-Researcher Pattern**:

    - Supervisor manages research questions and coordinates multiple researchers
    - Researchers execute parallel research with configurable concurrency
    - Results are compressed and assembled into final reports

2. **Configurable Models**:

    - Uses `init_chat_model()` API for provider flexibility
    - Separate models for: summarization, research, compression, final report
    - All models must support structured outputs and tool calling

3. **Search Integration**:

    - Supports multiple search APIs: Tavily, OpenAI Native, Anthropic Native
    - Search API compatibility requirements vary by model provider
    - MCP (Model Context Protocol) server support for extended capabilities

4. **State Management**:
    - Uses LangGraph's StateGraph for workflow orchestration
    - Memory persistence with checkpointers
    - Structured state objects for type safety

### Legacy Implementations (`src/legacy/`)

Two alternative approaches with different trade-offs:

-   **graph.py**: Plan-and-execute workflow with human-in-the-loop
-   **multi_agent.py**: Original supervisor-researcher multi-agent system

### Security (`src/security/`)

-   **auth.py**: Authentication handling for LangGraph deployment

## Important Considerations

1. **Model Requirements**:

    - All models MUST support structured outputs
    - Research/Compression models must be compatible with chosen search API
    - Native search requires matching model provider (e.g., Anthropic search needs Anthropic models)

2. **Environment Variables**:

    - Copy `.env.example` to `.env` for configuration
    - API keys are dynamically retrieved based on model provider

3. **Testing**:

    - Comprehensive evaluation system in `tests/` directory
    - 9 quality criteria for report evaluation
    - LangSmith integration for tracking results

4. **LangGraph Configuration**:
    - Configuration in `langgraph.json`
    - Python 3.11 requirement
    - Custom authentication path specified
