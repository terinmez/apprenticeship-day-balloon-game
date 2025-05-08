import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { ProblemDetailsSchema, BalloonSchema, UserStatisticsSchema } from '../schemas';
import { generateStrongETag, extractUserName } from '../utils/request-context';

// Assuming Bindings are defined in a types.ts or similar
// For example:
// export interface Bindings {
//   USER_STATS_KV: KVNamespace;
//   BALLOON_STATE_KV: KVNamespace;
//   [key: string]: any;
// }
// Using 'any' for env type here if Bindings is not strictly defined and imported.
type Env = {
  USER_STATS_KV: KVNamespace;
  BALLOON_STATE_KV: KVNamespace;
  // Add other expected KV/Durable Object bindings here
};

const BalloonPutRequestBodySchema = z.object({
  fillStatus: z.number().int().min(0).max(100).describe("The new fill status to set for the balloon. Must be current_fill_status + 1."),
});

const BalloonPutSuccessResponseSchema = z.object({
  fillStatus: z.number().int().describe("The updated fill status of the balloon."),
});

const BALLOON_STATUS_KEY = "globalBalloonStatus";

export class BalloonPut extends OpenAPIRoute {
  schema = {
    tags: ['Balloon'],
    summary: 'Update the fill status of the Balloon',
    security: [
      { bearerAuth: [] },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter API key as Bearer token',
        },
      },
    },
    request: {
      headers: z.object({
        authorization: z.string().describe('HTTP Bearer Authentication header, example: Bearer fooBarBaz'),
        'if-match': z.string().describe('The ETag of the balloon resource, used for optimistic concurrency control.'),
      }),
      body: {
        content: {
          'application/json': {
            schema: BalloonPutRequestBodySchema,
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Balloon fill status updated successfully.',
        content: { 'application/json': { schema: BalloonPutSuccessResponseSchema } },
        headers: z.object({ // Chanfana might require headers to be defined differently, this is a common OpenAPI way
          'ETag': z.string().describe('The new ETag of the balloon resource after the update.'),
        }),
      },
      '400': {
        description: 'Bad Request - Invalid fill status or balloon is already full.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '401': {
        description: 'Unauthorized - Missing or malformed Authorization token.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '412': {
        description: 'Precondition Failed - The ETag provided via If-Match does not match the current resource ETag.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '429': {
        description: 'Too Many Requests - Rate limit exceeded.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      },
      '500': {
        description: 'Internal Server Error - An unexpected error occurred.',
        content: { 'application/json': { schema: ProblemDetailsSchema } },
      }
    },
  };

  async handle(c: { env: Env, req: Request, data: any }) {
    // Define the base rate limit as a constant here
    const INITIAL_RATE_LIMIT_PER_MINUTE = 48;

    const validatedData = await this.getValidatedData<typeof this.schema>();

    const ifMatchHeader = validatedData.headers['if-match'];
    const requestedFillStatus = validatedData.body.fillStatus;
    const rawAuthHeader = validatedData.headers.authorization;
    const userName = extractUserName({ 'authorization': rawAuthHeader });

    if (!userName) {
      return new Response(JSON.stringify({ title: 'Unauthorized', status: 401, detail: 'Malformed or missing Authorization header.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      let userStats: z.infer<typeof UserStatisticsSchema>;
      const userStatsJson = await c.env.USER_STATS_KV.get(userName);
      if (userStatsJson) {
        userStats = UserStatisticsSchema.parse(JSON.parse(userStatsJson));
      } else {
        userStats = UserStatisticsSchema.parse({
          userName,
          hits: 0,
          misses: 0,
          total: 0,
          lastHit: new Date(0).toISOString(), 
          lastMiss: new Date(0).toISOString(),
          // initialRateLimitPerMinute is no longer here
          violationFactor: 1.0,         
          lastChangeRequestDate: new Date(0).toISOString(), 
        });
      }
      
      const currentTimeMs = new Date().getTime();
      const lastChangeRequestDateMs = new Date(userStats.lastChangeRequestDate).getTime();
      // Use the constant for initialRateLimitIntervalMs calculation
      const initialRateLimitIntervalMs = (60 / INITIAL_RATE_LIMIT_PER_MINUTE) * 1000;

      const FACTOR_INCREMENT = 0.01;
      const FACTOR_DECREMENT = 0.01;
      const MAX_EFFECTIVE_INTERVAL_MS = 60000; 
      const MIN_VIOLATION_FACTOR = 1.0;

      // 1. "Good Behavior" - Factor Reduction (logic remains the same, uses initialRateLimitIntervalMs)
      if (lastChangeRequestDateMs > 0) { 
        const timeSinceLastRequestAttemptMs = currentTimeMs - lastChangeRequestDateMs;
        if (timeSinceLastRequestAttemptMs > initialRateLimitIntervalMs) {
          const idleTimeBeyondFirstMandatoryInterval = timeSinceLastRequestAttemptMs - initialRateLimitIntervalMs;
          const numberOfIdleIntervals = Math.floor(idleTimeBeyondFirstMandatoryInterval / initialRateLimitIntervalMs);
          if (numberOfIdleIntervals > 0) {
            const totalDecrement = numberOfIdleIntervals * FACTOR_DECREMENT;
            userStats.violationFactor = Math.max(MIN_VIOLATION_FACTOR, userStats.violationFactor - totalDecrement);
          }
        }
      }

      // 2. Calculate current effective interval (logic remains the same, uses initialRateLimitIntervalMs)
      let currentEffectiveIntervalMs = initialRateLimitIntervalMs * userStats.violationFactor;
      currentEffectiveIntervalMs = Math.min(MAX_EFFECTIVE_INTERVAL_MS, currentEffectiveIntervalMs);
      currentEffectiveIntervalMs = Math.max(initialRateLimitIntervalMs, currentEffectiveIntervalMs);

      // 3. Rate Limiting Check (logic remains the same)
      const nextAllowedTimeMs = lastChangeRequestDateMs + currentEffectiveIntervalMs;
      if (lastChangeRequestDateMs > 0 && currentTimeMs < nextAllowedTimeMs) {
        userStats.violationFactor += FACTOR_INCREMENT;
        userStats.misses++; 
        userStats.total++;  
        userStats.lastChangeRequestDate = new Date(currentTimeMs).toISOString(); 
        await c.env.USER_STATS_KV.put(userName, JSON.stringify(userStats));
        const retryAfterDurationMs = nextAllowedTimeMs - currentTimeMs;
        return new Response(
          JSON.stringify({ title: 'Too Many Requests', status: 429, detail: 'Rate limit exceeded. Please try again later.' }), 
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(retryAfterDurationMs / 1000)) } }
        );
      } else {
        userStats.violationFactor = MIN_VIOLATION_FACTOR;
      }
      
      // 2. Fetch Balloon State Object 
      let currentFillStatus = 0; 
      let currentBalloonState: z.infer<typeof BalloonSchema> | null = null;
      const balloonStateJson = await c.env.BALLOON_STATE_KV.get(BALLOON_STATUS_KEY);
      if (balloonStateJson) {
        try {
           currentBalloonState = BalloonSchema.parse(JSON.parse(balloonStateJson));
           currentFillStatus = currentBalloonState.fillStatus ?? 0;
        } catch (e) {
          console.error("Failed to parse current balloon state from KV", e);
          currentBalloonState = BalloonSchema.parse({ fillStatus: 0 }); 
          currentFillStatus = 0;
        }
      } else {
          currentBalloonState = BalloonSchema.parse({ fillStatus: 0 }); 
          currentFillStatus = 0;
      }
      
      const currentETag = await generateStrongETag(currentBalloonState); 

      if (ifMatchHeader !== currentETag) {
        userStats.misses++; 
        userStats.total++;  
        userStats.lastMiss = new Date(currentTimeMs).toISOString(); 
        userStats.lastChangeRequestDate = new Date(currentTimeMs).toISOString(); 
        await c.env.USER_STATS_KV.put(userName, JSON.stringify(userStats));
        return new Response(JSON.stringify({ title: 'Precondition Failed', status: 412, detail: 'ETag does not match.' }), { status: 412, headers: { 'Content-Type': 'application/json' } });
      }

      if (currentFillStatus >= 100) {
        userStats.misses++; 
        userStats.total++;
        userStats.lastMiss = new Date(currentTimeMs).toISOString();
        userStats.lastChangeRequestDate = new Date(currentTimeMs).toISOString(); 
        await c.env.USER_STATS_KV.put(userName, JSON.stringify(userStats));
        return new Response(JSON.stringify({ title: 'Bad Request', status: 400, detail: 'Balloon is already 100% full.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (requestedFillStatus !== currentFillStatus + 1) {
        userStats.misses++; 
        userStats.total++;
        userStats.lastMiss = new Date(currentTimeMs).toISOString();
        userStats.lastChangeRequestDate = new Date(currentTimeMs).toISOString(); 
        await c.env.USER_STATS_KV.put(userName, JSON.stringify(userStats));
        return new Response(JSON.stringify({ title: 'Bad Request', status: 400, detail: `Next fillStatus must be ${currentFillStatus + 1}.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const newFillStatus = requestedFillStatus;
      const newBalloonState = { fillStatus: newFillStatus };
      const validatedNewState = BalloonSchema.parse(newBalloonState);
      await c.env.BALLOON_STATE_KV.put(BALLOON_STATUS_KEY, JSON.stringify(validatedNewState));

      userStats.hits++; 
      userStats.total++; 
      userStats.lastHit = new Date(currentTimeMs).toISOString(); 
      userStats.lastChangeRequestDate = new Date(currentTimeMs).toISOString(); 
      await c.env.USER_STATS_KV.put(userName, JSON.stringify(userStats));

      const newETag = await generateStrongETag(validatedNewState);
      return new Response(
        JSON.stringify({ fillStatus: newFillStatus }), 
        { status: 200, headers: { 'Content-Type': 'application/json', 'ETag': newETag } }
      );

    } catch (error) {
      console.error("Error in BalloonPut handle:", error);
      if (error instanceof z.ZodError) {
          return new Response(JSON.stringify({ title: 'Validation Error', status: 400, detail: 'Invalid request data structure.', issues: error.issues }), { status: 400, headers: { 'Content-Type': 'application/json' }});
      }
      return new Response(JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'An unexpected error occurred while processing your request.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
}
