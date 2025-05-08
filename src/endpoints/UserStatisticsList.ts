import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { ProblemDetailsSchema, UserStatisticsSchema } from '../schemas';
import { generateStrongETag } from '../utils/request-context';

// Assuming Env type is defined in a central types file or similar
// and includes USER_STATS_KV
type Env = {
  USER_STATS_KV: KVNamespace;
  // Add other expected KV/Durable Object bindings here
};

// Define an array schema for the response
const UserStatisticsListResponseSchema = z.array(UserStatisticsSchema);

export class UserStatisticsList extends OpenAPIRoute {
  schema = {
    tags: ['User Statistics'],
    summary: 'List statistics for all users',
    request: {
      query: z.object({
        orderBy: z.string().optional().describe('Sort order for the results. Format: field1 [asc|desc], field2 [asc|desc]... Example: hits desc, lastHit asc'),
      }),
    },
    responses: {
      '200': {
        description: 'Successfully retrieved user statistics for all users.',
        content: { 'application/json': { schema: UserStatisticsListResponseSchema } },
        headers: z.object({
          'ETag': z.string().describe('The ETag of the list of user statistics.'),
        }),
      },
      '500': {
        description: 'Internal Server Error - An unexpected error occurred.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
    },
  };

  async handle(c: { env: Env, req: Request }) {
    const validatedData = await this.getValidatedData<typeof this.schema>();
    const orderByParam = validatedData.query?.orderBy;

    try {
      const listResult = await c.env.USER_STATS_KV.list();
      const allUserStats: z.infer<typeof UserStatisticsSchema>[] = [];

      for (const key of listResult.keys) {
        const userStatsJson = await c.env.USER_STATS_KV.get(key.name);
        if (userStatsJson) {
          try {
            const stats = UserStatisticsSchema.parse(JSON.parse(userStatsJson));
            allUserStats.push(stats);
          } catch (parseError) {
            console.error(`Failed to parse statistics for key ${key.name}:`, parseError);
            // Optionally, decide if you want to skip this entry or return an error
          }
        }
      }

      // Parse orderByParam and sort allUserStats
      if (orderByParam) {
        const sortCriteria = orderByParam.split(',').map(criterion => {
          const parts = criterion.trim().split(' ');
          const field = parts[0];
          const direction = parts.length > 1 && parts[1].toLowerCase() === 'desc' ? 'desc' : 'asc';
          // Basic validation for field name (can be expanded)
          const validFields = Object.keys(UserStatisticsSchema.shape);
          if (!validFields.includes(field)) {
            // Potentially throw an error or ignore invalid field
            console.warn(`Invalid sort field: ${field}`);
            return null; 
          }
          return { field, direction };
        }).filter(Boolean) as { field: keyof z.infer<typeof UserStatisticsSchema>, direction: 'asc' | 'desc' }[];

        if (sortCriteria.length > 0) {
          allUserStats.sort((a, b) => {
            for (const { field, direction } of sortCriteria) {
              const valA = a[field];
              const valB = b[field];

              let comparison = 0;
              if (typeof valA === 'number' && typeof valB === 'number') {
                comparison = valA - valB;
              } else if (typeof valA === 'string' && typeof valB === 'string') {
                // For date strings like lastHit, direct string comparison works for ISO format
                comparison = valA.localeCompare(valB);
              }
              // Add more type handling if necessary (e.g., boolean)

              if (comparison !== 0) {
                return direction === 'asc' ? comparison : -comparison;
              }
            }
            return 0;
          });
        }
      }

      const etag = await generateStrongETag(allUserStats);

      return new Response(JSON.stringify(allUserStats), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'ETag': etag,
        },
      });

    } catch (error) {
      console.error('Error in UserStatisticsList handle:', error);
      return new Response(JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'An unexpected error occurred while fetching user statistics.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
}
