import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { ProblemDetailsSchema, UserStatisticsSchema } from '../schemas';
import { generateStrongETag } from '../utils/request-context';
// import { extractUserName } from '../utils/request-context'; // No longer needed here

// Assuming Env type is defined in a central types file or similar
// and includes USER_STATS_KV
type Env = {
  USER_STATS_KV: KVNamespace;
  // Add other expected KV/Durable Object bindings here
};

export class UserStatisticsGet extends OpenAPIRoute {
  schema = {
    tags: ['User Statistics'],
    summary: 'Get statistics for a specific user',
    request: {
      params: z.object({ // Changed from headers
        userName: z.string().describe("The username for which to retrieve statistics."),
      }),
    },
    responses: {
      '200': {
        description: 'Successfully retrieved user statistics.',
        content: { 'application/json': { schema: UserStatisticsSchema } },
        headers: z.object({
          'ETag': z.string().describe('The ETag of the user statistics resource.'),
        }),
      },
      '401': {
        description: 'Unauthorized - Missing or malformed Authorization token.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '404': {
        description: 'Not Found - User statistics not found for the given username.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '500': {
        description: 'Internal Server Error - An unexpected error occurred.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
    },
  };

  async handle(c: { env: Env, req: Request }) {
    const validatedData = await this.getValidatedData<typeof this.schema>();
    
    const userName = validatedData.params.userName; 

    try {
      const userStatsJson = await c.env.USER_STATS_KV.get(userName);

      if (userStatsJson === null) {
        return new Response(JSON.stringify({ title: 'Not Found', status: 404, detail: `User statistics for '${userName}' not found.` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      // Parse and validate against the schema
      const userStats = UserStatisticsSchema.parse(JSON.parse(userStatsJson));

      const etag = await generateStrongETag(userStats);

      return new Response(JSON.stringify(userStats), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'ETag': etag,
        },
      });

    } catch (error) {
      console.error(`Error in UserStatisticsGet handle for user ${userName}:`, error);
      if (error instanceof z.ZodError) {
        // This could happen if KV data is somehow corrupted and doesn't match UserStatisticsSchema
        return new Response(JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'Error parsing user statistics data.', issues: error.issues }), { status: 500, headers: { 'Content-Type': 'application/json' }});
      }
      return new Response(JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'An unexpected error occurred while fetching user statistics.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

  }
}
