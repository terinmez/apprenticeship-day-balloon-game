import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { BalloonSchema, ProblemDetailsSchema } from '../schemas';
import { Bindings } from 'types';
import { generateStrongETag } from '../utils/request-context';

// Assuming Env type includes BALLOON_STATE_KV
type Env = {
  // USER_STATS_KV may or may not be needed depending on auth/rate limiting layers
  BALLOON_STATE_KV: KVNamespace;
  // Add other expected KV/Durable Object bindings here
};

// Update success response schema to be the full BalloonSchema
// const BalloonGetSuccessResponseSchema = z.object({
//   fillStatus: z.number().int().describe(\"The current fill status of the balloon.\"),
// });
// Assuming BalloonSchema is imported and includes at least currentFillStatus and a timestamp

const BALLOON_STATUS_KEY = "globalBalloonStatus"; // Consistent key with BalloonPut

export class BalloonGet extends OpenAPIRoute {
  schema = {
    tags: ['Balloon'],
    summary: 'Get the current fill status and ETag of the Balloon',
    // Change security requirement back to bearerAuth
    security: [
      { bearerAuth: [] }, // Changed back from basicAuth
    ],
    // Change the security scheme definition back to bearer
    components: {
      securitySchemes: {
        bearerAuth: { // Changed back from basicAuth
          type: 'http',
          scheme: 'bearer', // Changed back from basic
          bearerFormat: 'token', // Or just 'token' or omit if not JWT specific
          description: 'Enter API key as Bearer token',
        },
      },
    },
    request: {
      headers: z.object({
        'authorization': z
          .string()
          .optional()
          .nullable()
          .describe('Optional: HTTP Bearer Authentication header, example: Bearer fooBarBaz'),
        'if-none-match': z.string().optional().nullable().describe('Optional: ETag for cache validation. If it matches the current ETag, a 304 Not Modified response is returned.'),
      }),
    },
    responses: {
      '200': {
        description: 'OK - Returns the current balloon state.',
        // Update content schema to BalloonSchema
        content: { 'application/json': { schema: BalloonSchema } }, 
        headers: z.object({ 
          'ETag': z.string().describe('The ETag based on the current fill status.'),
        }),
      },
      '304': {
        description: 'Not Modified - The client\'s cached version (ETag) is still valid.',
        // No content body for 304
        headers: z.object({ 
          'ETag': z.string().describe('The ETag of the current balloon resource state.'),
        }),
      },
      '401': { // If Authorization becomes strictly required later
        description: 'Unauthorized',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '500': {
        description: 'Internal Server Error - Could not retrieve or process balloon status.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      }
    },
  };

  async handle(c: { env: Env, req: Request }) {
    const validatedData = await this.getValidatedData<typeof this.schema>();
    const ifNoneMatchHeader = validatedData.headers['if-none-match'];

    let balloonState: z.infer<typeof BalloonSchema>;

    try {
      // 1. Fetch Balloon State JSON from KV
      const balloonStateJson = await c.env.BALLOON_STATE_KV.get(BALLOON_STATUS_KEY);

      if (balloonStateJson === null) {
        // 2a. Entry doesn't exist, create default state
        balloonState = BalloonSchema.parse({
          fillStatus: 0 
        });
        console.log('No balloon state found in KV, returning default.');
      } else {
        // 2b. Entry exists, parse it
        try {
          balloonState = BalloonSchema.parse(JSON.parse(balloonStateJson));
        } catch (parseError) {
          console.error("Error parsing balloon state from KV:", parseError, "Raw value:", balloonStateJson);
          return new Response(JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'Failed to parse stored balloon state.' }), {
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
          });
        }
      }

      // 3. Generate Current STRONG ETag using imported utility
      const currentETag = await generateStrongETag(balloonState);

      // 4. Check If-None-Match header
      if (ifNoneMatchHeader && ifNoneMatchHeader === currentETag) {
        // Client's version is up-to-date - return 304 with the strong ETag
        return new Response(null, { 
          status: 304, 
          headers: { 'ETag': currentETag } 
        });
      }

      // 5. Return current full state and strong ETag
      return new Response(
        JSON.stringify(balloonState), 
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            'ETag': currentETag // Return strong ETag
          } 
        }
      );

    } catch (error) {
      console.error("Error in BalloonGet handle fetching/processing state:", error);
      // Basic error handling for KV store issues or unexpected errors
      return new Response(JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'Could not retrieve or process balloon status.' }), {
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }
}
