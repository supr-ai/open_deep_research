declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // API Keys
      OPENAI_API_KEY?: string;
      ANTHROPIC_API_KEY?: string;
      GOOGLE_API_KEY?: string;
      TAVILY_API_KEY?: string;
      
      // Configuration
      MAX_STRUCTURED_OUTPUT_RETRIES?: string;
      ALLOW_CLARIFICATION?: string;
      MAX_CONCURRENT_RESEARCH_UNITS?: string;
      MAX_RESEARCHER_ITERATIONS?: string;
      MAX_REACT_TOOL_CALLS?: string;
      SUMMARIZATION_MODEL?: string;
      SUMMARIZATION_MODEL_MAX_TOKENS?: string;
      RESEARCH_MODEL?: string;
      RESEARCH_MODEL_MAX_TOKENS?: string;
      COMPRESSION_MODEL?: string;
      COMPRESSION_MODEL_MAX_TOKENS?: string;
      FINAL_REPORT_MODEL?: string;
      FINAL_REPORT_MODEL_MAX_TOKENS?: string;
      MCP_PROMPT?: string;
    }
  }
}

export {}; 
