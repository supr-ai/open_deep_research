import os from 'os';
import { createHash } from 'crypto';
import { DateTime } from 'luxon';

// Type definitions
export type SearchAPI = 'anthropic' | 'openai' | 'tavily' | 'none';
export type Topic = 'general' | 'news' | 'finance';

export interface Summary {
  summary: string;
  key_excerpts: string;
}

export interface ResearchComplete {
  // Define properties as needed
}

export interface Configuration {
  summarization_model: string;
  summarization_model_max_tokens: number;
  max_structured_output_retries: number;
  search_api: SearchAPI;
  mcp_config?: MCPConfig;
}

export interface MCPConfig {
  url: string;
  tools: string[];
  auth_required: boolean;
}

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  raw_content?: string;
}

export interface TavilyResponse {
  query: string;
  results: SearchResult[];
}

export interface RunnableConfig {
  configurable?: {
    thread_id?: string;
    mcp_config?: MCPConfig;
    'x-supabase-access-token'?: string;
    apiKeys?: Record<string, string>;
  };
  metadata?: {
    owner?: string;
  };
}

export interface BaseTool {
  name: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface StructuredTool extends BaseTool {
  coroutine: (...args: any[]) => Promise<any>;
}

export interface MessageLikeRepresentation {
  type: string;
  content: string;
}

export interface HumanMessage extends MessageLikeRepresentation {
  type: 'human';
}

export interface AIMessage extends MessageLikeRepresentation {
  type: 'ai';
  response_metadata?: {
    usage?: {
      server_tool_use?: {
        web_search_requests?: number;
      };
    };
  };
  additional_kwargs?: {
    tool_outputs?: Array<{
      type: string;
    }>;
  };
}

export interface ToolMessage extends MessageLikeRepresentation {
  type: 'tool';
}

export interface TokenData {
  access_token: string;
  expires_in: number;
  created_at: Date;
}

export interface McpError extends Error {
  error: {
    code?: number;
    data?: {
      message?: {
        text?: string;
      } | string;
      url?: string;
    };
  };
}

export class ToolException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolException';
  }
}

// Tavily Search Tool Utils
export const TAVILY_SEARCH_DESCRIPTION = 
  "A search engine optimized for comprehensive, accurate, and trusted results. " +
  "Useful for when you need to answer questions about current events.";

export async function tavily_search(
  queries: string[],
  max_results: number = 5,
  topic: Topic = 'general',
  config: RunnableConfig | null = null
): Promise<string> {
  const search_results = await tavily_search_async(
    queries,
    max_results,
    topic,
    true,
    config
  );
  
  // Format the search results and deduplicate results by URL
  let formatted_output = "Search results: \n\n";
  const unique_results: Record<string, SearchResult & { query: string }> = {};
  
  for (const response of search_results) {
    for (const result of response.results) {
      const url = result.url;
      if (!(url in unique_results)) {
        unique_results[url] = { ...result, query: response.query };
      }
    }
  }
  
  const configurable = Configuration_from_runnable_config(config);
  const max_char_to_include = 50000;
  const model_api_key = get_api_key_for_model(configurable.summarization_model, config);
  
  // Note: init_chat_model equivalent would need to be implemented separately
  // This is a placeholder for the summarization logic
  const summarization_tasks: Promise<string | null>[] = [];
  
  for (const result of Object.values(unique_results)) {
    if (!result.raw_content) {
      summarization_tasks.push(Promise.resolve(null));
    } else {
      summarization_tasks.push(
        summarize_webpage(
          null, // model placeholder
          result.raw_content.slice(0, max_char_to_include)
        )
      );
    }
  }
  
  const summaries = await Promise.all(summarization_tasks);
  const summarized_results: Record<string, { title: string; content: string }> = {};
  
  const urls = Object.keys(unique_results);
  const results = Object.values(unique_results);
  
  for (let i = 0; i < urls.length; i++) {
    summarized_results[urls[i]] = {
      title: results[i].title,
      content: summaries[i] === null ? results[i].content : summaries[i]
    };
  }
  
  let i = 0;
  for (const [url, result] of Object.entries(summarized_results)) {
    formatted_output += `\n\n--- SOURCE ${i + 1}: ${result.title} ---\n`;
    formatted_output += `URL: ${url}\n\n`;
    formatted_output += `SUMMARY:\n${result.content}\n\n`;
    formatted_output += "\n\n" + "-".repeat(80) + "\n";
    i++;
  }
  
  if (Object.keys(summarized_results).length > 0) {
    return formatted_output;
  } else {
    return "No valid search results found. Please try different search queries or use a different search API.";
  }
}

export async function tavily_search_async(
  search_queries: string[],
  max_results: number = 5,
  topic: Topic = 'general',
  include_raw_content: boolean = true,
  config: RunnableConfig | null = null
): Promise<TavilyResponse[]> {
  // Note: AsyncTavilyClient would need to be implemented separately
  const tavily_api_key = get_tavily_api_key(config);
  const search_tasks: Promise<TavilyResponse>[] = [];
  
  // Placeholder for actual Tavily API calls
  for (const query of search_queries) {
    // search_tasks.push(tavily_client.search(...))
  }
  
  const search_docs = await Promise.all(search_tasks);
  return search_docs;
}

export async function summarize_webpage(model: any, webpage_content: string): Promise<string> {
  try {
    // Note: This would need actual model implementation
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), 60000);
    });
    
    // Placeholder for actual summarization
    const summary: Summary = {
      summary: '',
      key_excerpts: ''
    };
    
    return `<summary>\n${summary.summary}\n</summary>\n\n<key_excerpts>\n${summary.key_excerpts}\n</key_excerpts>`;
  } catch (error) {
    console.error(`Failed to summarize webpage: ${error}`);
    return webpage_content;
  }
}

// MCP Utils
export async function get_mcp_access_token(
  supabase_token: string,
  base_mcp_url: string
): Promise<Record<string, any> | null> {
  try {
    const form_data = new URLSearchParams({
      client_id: 'mcp_default',
      subject_token: supabase_token,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      resource: base_mcp_url.replace(/\/$/, '') + '/mcp',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    
    const response = await fetch(
      base_mcp_url.replace(/\/$/, '') + '/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form_data.toString(),
      }
    );
    
    if (response.status === 200) {
      const token_data = await response.json();
      return token_data;
    } else {
      const response_text = await response.text();
      console.error(`Token exchange failed: ${response_text}`);
    }
  } catch (error) {
    console.error(`Error during token exchange: ${error}`);
  }
  return null;
}

export async function get_tokens(config: RunnableConfig): Promise<TokenData | null> {
  // Note: get_store() would need to be implemented separately
  const thread_id = config.configurable?.thread_id;
  if (!thread_id) {
    return null;
  }
  const user_id = config.metadata?.owner;
  if (!user_id) {
    return null;
  }
  
  // Placeholder for store.aget logic
  const tokens: any = null; // await store.aget([user_id, 'tokens'], 'data');
  if (!tokens) {
    return null;
  }
  
  const expires_in = tokens.value.expires_in;
  const created_at = new Date(tokens.created_at);
  const current_time = new Date();
  const expiration_time = new Date(created_at.getTime() + expires_in * 1000);
  
  if (current_time > expiration_time) {
    // await store.adelete([user_id, 'tokens'], 'data');
    return null;
  }
  
  return tokens.value;
}

export async function set_tokens(config: RunnableConfig, tokens: Record<string, any>): Promise<void> {
  // Note: get_store() would need to be implemented separately
  const thread_id = config.configurable?.thread_id;
  if (!thread_id) {
    return;
  }
  const user_id = config.metadata?.owner;
  if (!user_id) {
    return;
  }
  // await store.aput([user_id, 'tokens'], 'data', tokens);
  return;
}

export async function fetch_tokens(config: RunnableConfig): Promise<Record<string, any> | null> {
  const current_tokens = await get_tokens(config);
  if (current_tokens) {
    return current_tokens;
  }
  const supabase_token = config.configurable?.['x-supabase-access-token'];
  if (!supabase_token) {
    return null;
  }
  const mcp_config = config.configurable?.mcp_config;
  if (!mcp_config || !mcp_config.url) {
    return null;
  }
  const mcp_tokens = await get_mcp_access_token(supabase_token, mcp_config.url);
  
  if (mcp_tokens) {
    await set_tokens(config, mcp_tokens);
  }
  return mcp_tokens;
}

export function wrap_mcp_authenticate_tool(tool: StructuredTool): StructuredTool {
  const old_coroutine = tool.coroutine;
  
  async function wrapped_mcp_coroutine(...args: any[]): Promise<any> {
    function _find_first_mcp_error_nested(exc: Error): McpError | null {
      if (exc && 'error' in exc && typeof exc.error === 'object') {
        return exc as McpError;
      }
      // ExceptionGroup handling would need separate implementation
      return null;
    }
    
    try {
      return await old_coroutine(...args);
    } catch (e_orig) {
      const error = e_orig as Error;
      const mcp_error = _find_first_mcp_error_nested(error);
      if (!mcp_error) {
        throw e_orig;
      }
      const error_details = mcp_error.error;
      const is_interaction_required = error_details.code === -32003;
      const error_data = error_details.data || {};
      
      if (is_interaction_required) {
        const message_payload = error_data.message || {};
        let error_message_text = "Required interaction";
        if (typeof message_payload === 'object' && 'text' in message_payload) {
          error_message_text = message_payload.text || error_message_text;
        }
        if (error_data.url) {
          error_message_text = `${error_message_text} ${error_data.url}`;
        }
        throw new ToolException(error_message_text);
      }
      throw e_orig;
    }
  }
  
  tool.coroutine = wrapped_mcp_coroutine;
  return tool;
}

export async function load_mcp_tools(
  config: RunnableConfig,
  existing_tool_names: Set<string>
): Promise<BaseTool[]> {
  const configurable = Configuration_from_runnable_config(config);
  let mcp_tokens: Record<string, any> | null = null;
  
  if (configurable.mcp_config && configurable.mcp_config.auth_required) {
    mcp_tokens = await fetch_tokens(config);
  }
  
  if (!(configurable.mcp_config && configurable.mcp_config.url && configurable.mcp_config.tools && 
        (mcp_tokens || !configurable.mcp_config.auth_required))) {
    return [];
  }
  
  const tools: BaseTool[] = [];
  const server_url = configurable.mcp_config.url.replace(/\/$/, '') + '/mcp';
  const mcp_server_config = {
    server_1: {
      url: server_url,
      headers: mcp_tokens ? { Authorization: `Bearer ${mcp_tokens.access_token}` } : undefined,
      transport: 'streamable_http'
    }
  };
  
  try {
    // Note: MultiServerMCPClient would need to be implemented separately
    const mcp_tools: StructuredTool[] = []; // await client.get_tools();
    
    for (const tool of mcp_tools) {
      if (existing_tool_names.has(tool.name)) {
        console.warn(
          `Trying to add MCP tool with a name ${tool.name} that is already in use - this tool will be ignored.`
        );
        continue;
      }
      if (!configurable.mcp_config.tools.includes(tool.name)) {
        continue;
      }
      tools.push(wrap_mcp_authenticate_tool(tool));
    }
  } catch (error) {
    console.error(`Error loading MCP tools: ${error}`);
    return [];
  }
  
  return tools;
}

// Tool Utils
export async function get_search_tool(search_api: SearchAPI): Promise<any[]> {
  if (search_api === 'anthropic') {
    return [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  } else if (search_api === 'openai') {
    return [{ type: 'web_search_preview' }];
  } else if (search_api === 'tavily') {
    const search_tool = {
      name: 'tavily_search',
      description: TAVILY_SEARCH_DESCRIPTION,
      metadata: { type: 'search', name: 'web_search' },
      // Function implementation would be added here
    };
    return [search_tool];
  } else if (search_api === 'none') {
    return [];
  }
  return [];
}

export async function get_all_tools(config: RunnableConfig): Promise<any[]> {
  const tools: any[] = [/* tool(ResearchComplete) */]; // Placeholder
  const configurable = Configuration_from_runnable_config(config);
  const search_api = get_config_value(configurable.search_api) as SearchAPI;
  tools.push(...await get_search_tool(search_api));
  
  const existing_tool_names = new Set<string>();
  for (const tool of tools) {
    const name = typeof tool === 'object' && 'name' in tool ? tool.name : 'web_search';
    existing_tool_names.add(name);
  }
  
  const mcp_tools = await load_mcp_tools(config, existing_tool_names);
  tools.push(...mcp_tools);
  return tools;
}

export function get_notes_from_tool_calls(messages: MessageLikeRepresentation[]): string[] {
  return messages
    .filter(msg => msg.type === 'tool')
    .map(msg => msg.content);
}

// Model Provider Native Websearch Utils
export function anthropic_websearch_called(response: AIMessage): boolean {
  try {
    const usage = response.response_metadata?.usage;
    if (!usage) {
      return false;
    }
    const server_tool_use = usage.server_tool_use;
    if (!server_tool_use) {
      return false;
    }
    const web_search_requests = server_tool_use.web_search_requests;
    if (web_search_requests === undefined) {
      return false;
    }
    return web_search_requests > 0;
  } catch (error) {
    return false;
  }
}

export function openai_websearch_called(response: AIMessage): boolean {
  const tool_outputs = response.additional_kwargs?.tool_outputs;
  if (tool_outputs) {
    for (const tool_output of tool_outputs) {
      if (tool_output.type === 'web_search_call') {
        return true;
      }
    }
  }
  return false;
}

// Token Limit Exceeded Utils
export function is_token_limit_exceeded(exception: Error, model_name?: string | null): boolean {
  const error_str = exception.toString().toLowerCase();
  let provider: string | null = null;
  
  if (model_name) {
    const model_str = model_name.toLowerCase();
    if (model_str.startsWith('openai:')) {
      provider = 'openai';
    } else if (model_str.startsWith('anthropic:')) {
      provider = 'anthropic';
    } else if (model_str.startsWith('gemini:') || model_str.startsWith('google:')) {
      provider = 'gemini';
    }
  }
  
  if (provider === 'openai') {
    return _check_openai_token_limit(exception, error_str);
  } else if (provider === 'anthropic') {
    return _check_anthropic_token_limit(exception, error_str);
  } else if (provider === 'gemini') {
    return _check_gemini_token_limit(exception, error_str);
  }
  
  return (_check_openai_token_limit(exception, error_str) ||
          _check_anthropic_token_limit(exception, error_str) ||
          _check_gemini_token_limit(exception, error_str));
}

function _check_openai_token_limit(exception: Error, error_str: string): boolean {
  const exception_type = exception.constructor.toString();
  const class_name = exception.constructor.name;
  const module_name = (exception.constructor as any).__module__ || '';
  
  const is_openai_exception = (exception_type.toLowerCase().includes('openai') || 
                               module_name.toLowerCase().includes('openai'));
  const is_bad_request = ['BadRequestError', 'InvalidRequestError'].includes(class_name);
  
  if (is_openai_exception && is_bad_request) {
    const token_keywords = ['token', 'context', 'length', 'maximum context', 'reduce'];
    if (token_keywords.some(keyword => error_str.includes(keyword))) {
      return true;
    }
  }
  
  if ('code' in exception && 'type' in exception) {
    if ((exception as any).code === 'context_length_exceeded' ||
        (exception as any).type === 'invalid_request_error') {
      return true;
    }
  }
  return false;
}

function _check_anthropic_token_limit(exception: Error, error_str: string): boolean {
  const exception_type = exception.constructor.toString();
  const class_name = exception.constructor.name;
  const module_name = (exception.constructor as any).__module__ || '';
  
  const is_anthropic_exception = (exception_type.toLowerCase().includes('anthropic') || 
                                  module_name.toLowerCase().includes('anthropic'));
  const is_bad_request = class_name === 'BadRequestError';
  
  if (is_anthropic_exception && is_bad_request) {
    if (error_str.includes('prompt is too long')) {
      return true;
    }
  }
  return false;
}

function _check_gemini_token_limit(exception: Error, error_str: string): boolean {
  const exception_type = exception.constructor.toString();
  const class_name = exception.constructor.name;
  const module_name = (exception.constructor as any).__module__ || '';
  
  const is_google_exception = (exception_type.toLowerCase().includes('google') || 
                              module_name.toLowerCase().includes('google'));
  const is_resource_exhausted = ['ResourceExhausted', 'GoogleGenerativeAIFetchError'].includes(class_name);
  
  if (is_google_exception && is_resource_exhausted) {
    return true;
  }
  if (exception_type.toLowerCase().includes('google.api_core.exceptions.resourceexhausted')) {
    return true;
  }
  
  return false;
}

// Model token limits mapping
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "openai:gpt-4.1-mini": 1047576,
  "openai:gpt-4.1-nano": 1047576,
  "openai:gpt-4.1": 1047576,
  "openai:gpt-4o-mini": 128000,
  "openai:gpt-4o": 128000,
  "openai:o4-mini": 200000,
  "openai:o3-mini": 200000,
  "openai:o3": 200000,
  "openai:o3-pro": 200000,
  "openai:o1": 200000,
  "openai:o1-pro": 200000,
  "anthropic:claude-opus-4": 200000,
  "anthropic:claude-sonnet-4": 200000,
  "anthropic:claude-3-7-sonnet": 200000,
  "anthropic:claude-3-5-sonnet": 200000,
  "anthropic:claude-3-5-haiku": 200000,
  "google:gemini-1.5-pro": 2097152,
  "google:gemini-1.5-flash": 1048576,
  "google:gemini-pro": 32768,
  "cohere:command-r-plus": 128000,
  "cohere:command-r": 128000,
  "cohere:command-light": 4096,
  "cohere:command": 4096,
  "mistral:mistral-large": 32768,
  "mistral:mistral-medium": 32768,
  "mistral:mistral-small": 32768,
  "mistral:mistral-7b-instruct": 32768,
  "ollama:codellama": 16384,
  "ollama:llama2:70b": 4096,
  "ollama:llama2:13b": 4096,
  "ollama:llama2": 4096,
  "ollama:mistral": 32768,
};

export function get_model_token_limit(model_string: string): number | null {
  for (const [key, token_limit] of Object.entries(MODEL_TOKEN_LIMITS)) {
    if (model_string.includes(key)) {
      return token_limit;
    }
  }
  return null;
}

export function remove_up_to_last_ai_message(messages: MessageLikeRepresentation[]): MessageLikeRepresentation[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'ai') {
      return messages.slice(0, i);
    }
  }
  return messages;
}

// Misc Utils
export function get_today_str(): string {
  return DateTime.now().toFormat('ccc LLL d, yyyy');
}

export function get_config_value(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  } else if (typeof value === 'object' && value !== null) {
    if ('value' in value) {
      return value.value;
    }
    return value;
  } else {
    return value;
  }
}

export function get_api_key_for_model(model_name: string, config: RunnableConfig | null): string | null {
  const should_get_from_config = process.env.GET_API_KEYS_FROM_CONFIG || 'false';
  model_name = model_name.toLowerCase();
  
  if (should_get_from_config.toLowerCase() === 'true') {
    const api_keys = config?.configurable?.apiKeys || {};
    if (!api_keys) {
      return null;
    }
    if (model_name.startsWith('openai:')) {
      return api_keys.OPENAI_API_KEY || null;
    } else if (model_name.startsWith('anthropic:')) {
      return api_keys.ANTHROPIC_API_KEY || null;
    } else if (model_name.startsWith('google')) {
      return api_keys.GOOGLE_API_KEY || null;
    }
    return null;
  } else {
    if (model_name.startsWith('openai:')) {
      return process.env.OPENAI_API_KEY || null;
    } else if (model_name.startsWith('anthropic:')) {
      return process.env.ANTHROPIC_API_KEY || null;
    } else if (model_name.startsWith('google')) {
      return process.env.GOOGLE_API_KEY || null;
    }
    return null;
  }
}

export function get_tavily_api_key(config: RunnableConfig | null): string | null {
  const should_get_from_config = process.env.GET_API_KEYS_FROM_CONFIG || 'false';
  
  if (should_get_from_config.toLowerCase() === 'true') {
    const api_keys = config?.configurable?.apiKeys || {};
    if (!api_keys) {
      return null;
    }
    return api_keys.TAVILY_API_KEY || null;
  } else {
    return process.env.TAVILY_API_KEY || null;
  }
}

// Helper function for Configuration.from_runnable_config
function Configuration_from_runnable_config(config: RunnableConfig | null): Configuration {
  // This is a placeholder - actual implementation would need to match Python logic
  return {
    summarization_model: '',
    summarization_model_max_tokens: 0,
    max_structured_output_retries: 3,
    search_api: 'tavily',
    mcp_config: config?.configurable?.mcp_config
  };
}