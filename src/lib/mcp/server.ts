import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateApiKey, hasScope, actorForApiKey } from "./auth";
import { readToolDefinitions } from "./tools-read";
import { mutateToolDefinitions } from "./tools-mutate";

export async function buildMcpServerForToken(
  rawToken: string,
): Promise<McpServer | null> {
  const key = await authenticateApiKey(rawToken);
  if (!key) return null;

  const canRead =
    hasScope(key.scopes, "catalog:read") ||
    hasScope(key.scopes, "pricing:admin");
  const canMutate = hasScope(key.scopes, "pricing:admin");
  if (!canRead) return null;

  const server = new McpServer({
    name: "atnative-pricing",
    version: "1.0.0",
  });

  // Read tools — available to catalog:read and pricing:admin
  for (const [name, def] of Object.entries(readToolDefinitions)) {
    const shape = def.parameters.shape;
    server.tool(
      name,
      def.description,
      shape,
      async (args: Record<string, unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = def.parameters.parse(args) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (def.handler as (a: any) => Promise<unknown>)(parsed);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  // Mutation tools — only for pricing:admin
  if (canMutate) {
    const mutators = mutateToolDefinitions(actorForApiKey(key.id));
    for (const [name, def] of Object.entries(mutators)) {
      const shape = def.parameters.shape;
      server.tool(
        name,
        def.description,
        shape,
        async (args: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed = def.parameters.parse(args) as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (def.handler as (a: any) => Promise<unknown>)(parsed);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        },
      );
    }
  }

  return server;
}
