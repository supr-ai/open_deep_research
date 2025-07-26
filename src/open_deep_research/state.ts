import { MessageLikeRepresentation } from './utils';

// Structured Outputs
export class ConductResearch {
  /**
   * Call this tool to conduct research on a specific topic.
   */
  research_topic: string;

  constructor(research_topic: string) {
    // The topic to research. Should be a single topic, and should be described in high detail (at least a paragraph).
    this.research_topic = research_topic;
  }
}

export class ResearchComplete {
  /**
   * Call this tool to indicate that the research is complete.
   */
}

export interface Summary {
  summary: string;
  key_excerpts: string;
}

export class ClarifyWithUser {
  need_clarification: boolean;
  question: string;
  verification: string;

  constructor(
    need_clarification: boolean,
    question: string,
    verification: string
  ) {
    // Whether the user needs to be asked a clarifying question.
    this.need_clarification = need_clarification;
    // A question to ask the user to clarify the report scope
    this.question = question;
    // Verify message that we will start research after the user has provided the necessary information.
    this.verification = verification;
  }
}

export class ResearchQuestion {
  research_brief: string;

  constructor(research_brief: string) {
    // A research question that will be used to guide the research.
    this.research_brief = research_brief;
  }
}

// State Definitions

// Reducer function for override behavior
export function override_reducer<T>(current_value: T | T[], new_value: T | T[] | { type: string; value?: T | T[] }): T | T[] {
  if (typeof new_value === 'object' && new_value !== null && 'type' in new_value && new_value.type === 'override') {
    return new_value.value !== undefined ? new_value.value : new_value as T | T[];
  } else {
    // Default to concatenation for arrays, replacement for other types
    if (Array.isArray(current_value) && Array.isArray(new_value)) {
      return [...current_value, ...new_value];
    } else if (Array.isArray(current_value) && !Array.isArray(new_value)) {
      return [...current_value, new_value as T];
    } else {
      return new_value;
    }
  }
}

// Base MessagesState interface
export interface MessagesState {
  messages: MessageLikeRepresentation[];
}

// Agent Input State
export interface AgentInputState extends MessagesState {
  /**
   * InputState is only 'messages'
   */
}

// Agent State
export interface AgentState extends MessagesState {
  supervisor_messages: MessageLikeRepresentation[];
  research_brief?: string | null;
  raw_notes: string[];
  notes: string[];
  final_report: string;
}

// Supervisor State
export interface SupervisorState {
  supervisor_messages: MessageLikeRepresentation[];
  research_brief: string;
  notes: string[];
  research_iterations: number;
  raw_notes: string[];
}

// Researcher State
export interface ResearcherState {
  researcher_messages: MessageLikeRepresentation[];
  tool_call_iterations: number;
  research_topic: string;
  compressed_research: string;
  raw_notes: string[];
}

// Researcher Output State
export class ResearcherOutputState {
  compressed_research: string;
  raw_notes: string[];

  constructor(compressed_research: string, raw_notes: string[] = []) {
    this.compressed_research = compressed_research;
    this.raw_notes = raw_notes;
  }
}

// Type annotations for LangGraph state management
// These would be used with a TypeScript version of LangGraph
export type AnnotatedAgentState = {
  [K in keyof AgentState]: K extends 'supervisor_messages' | 'raw_notes' | 'notes' 
    ? { value: AgentState[K]; reducer: typeof override_reducer }
    : AgentState[K];
};

export type AnnotatedSupervisorState = {
  [K in keyof SupervisorState]: K extends 'supervisor_messages' | 'notes' | 'raw_notes'
    ? { value: SupervisorState[K]; reducer: typeof override_reducer }
    : SupervisorState[K];
};

export type AnnotatedResearcherState = {
  [K in keyof ResearcherState]: K extends 'researcher_messages'
    ? { value: ResearcherState[K]; reducer: (curr: MessageLikeRepresentation[], next: MessageLikeRepresentation[]) => MessageLikeRepresentation[] }
    : K extends 'raw_notes'
    ? { value: ResearcherState[K]; reducer: typeof override_reducer }
    : ResearcherState[K];
};

// Helper type for optional fields
export type Optional<T> = T | null | undefined;

// Default values for state initialization
export const DEFAULT_AGENT_STATE: Partial<AgentState> = {
  messages: [],
  supervisor_messages: [],
  research_brief: null,
  raw_notes: [],
  notes: [],
  final_report: ''
};

export const DEFAULT_SUPERVISOR_STATE: Partial<SupervisorState> = {
  supervisor_messages: [],
  research_brief: '',
  notes: [],
  research_iterations: 0,
  raw_notes: []
};

export const DEFAULT_RESEARCHER_STATE: Partial<ResearcherState> = {
  researcher_messages: [],
  tool_call_iterations: 0,
  research_topic: '',
  compressed_research: '',
  raw_notes: []
};