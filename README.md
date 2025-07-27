# Open Deep Research (TypeScript)

<img width="1388" height="298" alt="full_diagram" src="https://github.com/user-attachments/assets/12a2371b-8be2-4219-9b48-90503eb43c69" />

Deep research has broken out as one of the most popular agent applications. This is a simple, configurable, fully open source deep research agent that works across many model providers and uses Tavily for web search. 

**This is the TypeScript version of the original Python implementation.**

* Read more in our [blog](https://blog.langchain.com/open-deep-research/) 
* See our [video](https://www.youtube.com/watch?v=agGiWUpxkhg) for a quick overview

### 🚀 Quickstart

1. Clone the repository and install dependencies:
```bash
git clone https://github.com/langchain-ai/open_deep_research.git
cd open_deep_research
npm install
```

2. Set up your `.env` file to customize the environment variables (for model selection, search tools, and other configuration settings):
```bash
cp .env.example .env
```

3. Build the TypeScript project:
```bash
npm run build
```

4. Launch the assistant with the LangGraph server locally to open LangGraph Studio in your browser:

```bash
# Start the LangGraph server
npx langgraph dev --allow-blocking
```

Use this to open the Studio UI:
```
- 🚀 API: http://127.0.0.1:2024
- 🎨 Studio UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
- 📚 API Docs: http://127.0.0.1:2024/docs
```

<img width="817" height="666" alt="Screenshot 2025-07-13 at 11 21 12 PM" src="https://github.com/user-attachments/assets/052f2ed3-c664-4a4f-8ec2-074349dcaa3f" />

Ask a question in the `messages` input field and click `Submit`.

### TypeScript Development

To run the project in development mode:

```bash
npm run dev
```

To build for production:

```bash
npm run build
npm start
```

### Basic Usage

```typescript
import { runResearch, Configuration } from "./src/index.js";

// Basic usage
const result = await runResearch("What are the latest developments in AI safety?");
console.log(result.final_report);

// With custom configuration
const config = new Configuration({
  max_concurrent_research_units: 3,
  research_model: "anthropic:claude-3-5-sonnet",
  allow_clarification: false
});

const result2 = await runResearch("Compare electric vehicles vs gas vehicles", config);
console.log(result2.final_report);
```

### Configurations

Open Deep Research offers extensive configuration options to customize the research process and model behavior. All configurations can be set via the web UI, environment variables, or by modifying the configuration directly.

#### General Settings

- **Max Structured Output Retries** (default: 3): Maximum number of retries for structured output calls from models when parsing fails
- **Allow Clarification** (default: true): Whether to allow the researcher to ask clarifying questions before starting research
- **Max Concurrent Research Units** (default: 5): Maximum number of research units to run concurrently using sub-agents. Higher values enable faster research but may hit rate limits

#### Research Configuration

- **Max Researcher Iterations** (default: 3): Number of times the Research Supervisor will reflect on research and ask follow-up questions
- **Max React Tool Calls** (default: 5): Maximum number of tool calling iterations in a single researcher step

#### Models

Open Deep Research uses multiple specialized models for different research tasks:

- **Summarization Model** (default: `openai:gpt-4.1-nano`): Summarizes research results from Tavily search
- **Research Model** (default: `openai:gpt-4.1`): Conducts research and analysis 
- **Compression Model** (default: `openai:gpt-4.1-mini`): Compresses research findings from sub-agents
- **Final Report Model** (default: `openai:gpt-4.1`): Writes the final comprehensive report

All models are configured using the init_chat_model() API which supports providers like OpenAI, Anthropic, Google Vertex AI, and others.

**Important Model Requirements:**

1. **Structured Outputs**: All models must support structured outputs. Check support [here](https://js.langchain.com/docs/integrations/chat/).

2. **Tool Calling**: All models must support tool calling for Tavily search integration
   - OpenAI search requires OpenAI models with web search capability  
   - Tavily works with all models

3. **Tool Calling**: All models must support tool calling functionality

### Project Structure

```
src/
├── configuration.ts    # Configuration class and settings
├── deepResearcher.ts   # Main LangGraph implementation
├── prompts.ts          # Prompt templates
├── state.ts            # State management interfaces
├── utils.ts            # Utility functions and tools
└── index.ts            # Main entry point and exports
```

### Deployments and Usages

#### LangGraph Studio

Follow the [quickstart](#-quickstart) to start LangGraph server locally and use the agent on LangGraph Studio.

#### Hosted deployment
 
You can easily deploy to [LangGraph Platform](https://langchain-ai.github.io/langgraph/concepts/#deployment-options). 

### API Usage

```typescript
import { deepResearcher } from "./dist/index.js";
import { HumanMessage } from "@langchain/core/messages";

const result = await deepResearcher.invoke({
  messages: [new HumanMessage({ content: "Research the latest AI trends" })]
}, {
  configurable: {
    research_model: "openai:gpt-4.1",
    max_concurrent_research_units: 3
  }
});

console.log(result.final_report);
```

### Environment Variables

Required environment variables:

- `TAVILY_API_KEY`: Your Tavily search API key
- `OPENAI_API_KEY`: Your OpenAI API key (if using OpenAI models)
- `ANTHROPIC_API_KEY`: Your Anthropic API key (if using Claude models)
- `GOOGLE_API_KEY`: Your Google API key (if using Gemini models)

Optional configuration via environment variables:

- `MAX_STRUCTURED_OUTPUT_RETRIES`: Maximum retries for structured outputs
- `ALLOW_CLARIFICATION`: Whether to allow clarifying questions
- `MAX_CONCURRENT_RESEARCH_UNITS`: Maximum concurrent research units
- `RESEARCH_MODEL`: Default research model to use
- `SUMMARIZATION_MODEL`: Default summarization model to use
- `COMPRESSION_MODEL`: Default compression model to use
- `FINAL_REPORT_MODEL`: Default final report model to use

### Differences from Python Version

This TypeScript implementation maintains 1:1 functional parity with the Python version while adapting to TypeScript/JavaScript patterns:

1. **Type Safety**: Full TypeScript typing for all interfaces and functions
2. **ES Modules**: Uses modern JavaScript module system
3. **LangChain.js**: Uses the JavaScript version of LangChain
4. **Node.js**: Runs on Node.js runtime instead of Python
5. **npm/package.json**: Uses npm for dependency management

The core functionality, prompts, and research logic remain identical to ensure consistent behavior across both implementations.
