import { StateGraph, StateGraphInterface, execute } from "@langchain/langgraph";
import { OpenAI } from "@langchain/openai";
import { OpenRouter } from "@langchain/openai"
import { config } from "./config.js";
import { openRouterClient } from "./openrouter.js";

// Define the agent state
interface AgentState {
  chatId: string;
  botId: string;
  botJob: string;
  botInstructions: string;
  conversationHistory: string[];
  currentPrompt: string;
}

// Create the LangGraph state graph
const agentGraph = new StateGraph<AgentState>("AgentGraph");

// Define the model node
const modelNode = agentGraph.addNode(
  "model",
  async (state: AgentState, inputs: any) => {
    const prompt = state.currentPrompt;
    const response = await openRouterClient.chat.completions.create({
      model: config.openRouter.model,
      messages: [
        {
          role: "system",
          content: `${state.botJob}

${state.botInstructions}

You are an assistant that responds to user messages in the context of the bot's job and instructions. Respond as concisely as possible.`,
        },
        ...state.conversationHistory.map((msg, i) => (
          {
            role: msg.role,
            content: msg.content,
          }
        )),
        {
          role: "user",
          content: inputs.message,
        },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    });
    return {
      response: response.choices[0].message.content,
    };
  }
);

// Define the agent workflow
agentGraph.addEdge(
  "model",
  "model",
  async (state: AgentState, inputs: any) => {
    return {
      conversationHistory: [...state.conversationHistory, {
        role: "user",
        content: inputs.message,
      }],
      currentPrompt: state.currentPrompt + inputs.message + "\nASSISTANT: ",
    };
  }
);

// Compile the graph
const agent = agentGraph.compile();

export { agentGraph, agent };