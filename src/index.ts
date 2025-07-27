import { deepResearcher } from "./deepResearcher.js";
import { Configuration } from "./configuration.js";
import { HumanMessage } from "@langchain/core/messages";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Export the main components
export { deepResearcher } from "./deepResearcher.js";
export { Configuration } from "./configuration.js";
export * from "./state.js";
export * from "./prompts.js";
export * from "./utils.js";

// Example usage function
export async function runResearch(query: string, config?: Partial<Configuration>) {
  const configuration = new Configuration(config);
  
  const result = await deepResearcher.invoke(
    {
      messages: [new HumanMessage({ content: query })]
    },
    {
      configurable: configuration
    }
  );
  
  return result;
}

// CLI usage if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const query = process.argv[2];
  if (!query) {
    console.error("Please provide a research query as an argument");
    process.exit(1);
  }
  
  runResearch(query)
    .then(result => {
      console.log("Research completed!");
      console.log("Final Report:", result.final_report);
    })
    .catch(error => {
      console.error("Error during research:", error);
      process.exit(1);
    });
} 
