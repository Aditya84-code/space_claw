/**
 * tools/web-search.ts — Web search via Tavily
 *
 * Tavily is purpose-built for AI agents: it returns clean, scored results
 * and optionally an LLM-ready answer summary.
 * Free tier: 1,000 credits/month — https://app.tavily.com
 *
 * Tool schema exposed to the LLM:
 *   web_search(query, count?)
 *     - query: the search string
 *     - count: number of results to return (1-10, default 5)
 */

import { tavily } from "@tavily/core";
import type { ToolDefinition } from "./index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const webSearchTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "web_search",
            description:
                "Search the web using Tavily and return the top results with titles, snippets, and URLs. " +
                "Use this whenever the owner asks for current information, news, facts you might not know, " +
                "or anything requiring an up-to-date answer.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query to look up",
                    },
                    count: {
                        type: "number",
                        description: "Number of results to return (1-10). Default 5.",
                    },
                },
                required: ["query"],
            },
        },
    },

    async execute(args) {
        const query = String(args.query ?? "").trim();
        const count = Math.min(10, Math.max(1, Number(args.count ?? 5)));

        if (!query) return "Error: search query cannot be empty.";

        if (!config.TAVILY_API_KEY) {
            return "Error: TAVILY_API_KEY is not configured. Add it to .env and restart.";
        }

        logger.info("web_search called (Tavily)", { query, count });

        try {
            const client = tavily({ apiKey: config.TAVILY_API_KEY });

            const response = await client.search(query, {
                maxResults: count,
                searchDepth: "basic",   // "basic" = fast; use "advanced" for deeper research
                includeAnswer: true,    // Tavily's AI-generated answer summary
            });

            // Build the formatted output
            const lines: string[] = [];

            // Prepend Tavily's answer summary if available
            if (response.answer) {
                lines.push(`📝 **Summary:** ${response.answer}\n`);
            }

            if (response.results.length === 0) {
                return lines.length > 0
                    ? lines.join("\n")
                    : `No results found for: "${query}"`;
            }

            lines.push(`Search results for "${query}":\n`);

            response.results.forEach((r, i) => {
                const snippet = r.content?.trim() ?? "(no description)";
                const date = r.publishedDate
                    ? ` · ${r.publishedDate.slice(0, 10)}`
                    : "";
                lines.push(`${i + 1}. **${r.title}**${date}\n   ${r.url}\n   ${snippet}`);
            });

            logger.debug("Tavily search complete", {
                results: response.results.length,
                responseTime: response.responseTime,
            });

            return lines.join("\n\n");
        } catch (err) {
            logger.error("Tavily web_search failed", { err: String(err) });
            return `Error performing web search: ${String(err)}`;
        }
    },
};
