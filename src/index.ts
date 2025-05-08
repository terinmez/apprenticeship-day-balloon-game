import { fromHono } from "chanfana";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { BalloonGet } from "./endpoints/balloonGet";
import { BalloonPut } from "./endpoints/balloonPut";
import { Bindings } from "./types";
import { UserStatisticsGet } from "./endpoints/UserStatisticsGet";
import { UserStatisticsList } from "./endpoints/UserStatisticsList";

const app = new Hono<{ Bindings: Bindings }>()

const openapi = fromHono(app, {
	docs_url: "/",
});

openapi.get("/balloon", BalloonGet);
openapi.put("/balloon", BalloonPut);
openapi.get("/userStatistics/:userName", UserStatisticsGet);
openapi.get("/userStatistics", UserStatisticsList);

export default {
	async fetch(
		request: Request,
		env: Bindings,
		ctx: ExecutionContext
	): Promise<Response> {
		try {
			// Try to match an API route first
			return await app.fetch(request, env, ctx);
		} catch (e) {
			if (e instanceof HTTPException && e.res.status === 404) {
				// If Hono throws a 404, try to serve from static assets
				// Make sure env.ASSETS is available (bound in wrangler.jsonc)
				if (env.ASSETS) {
					try {
						// Try to serve static asset
						return await env.ASSETS.fetch(request);
					} catch (assetError) {
						// If asset fetching also fails (e.g., file not found in /public),
						// return a generic 404 or the original Hono 404.
						// Log the assetError for debugging if needed.
						console.warn(`Static asset not found or error fetching: ${request.url}`, assetError);
						return new Response("Not Found", { status: 404 }); // Or return e.res from Hono
					}
				}
				// If ASSETS binding is not available, return Hono's 404 response
				return e.res;
			}
			// For other errors, re-throw or handle as appropriate
			console.error("Unhandled error in fetch handler:", e);
			// Return a generic 500 error or the original error response if available
			const errorResponse = e instanceof HTTPException ? e.res : new Response("Internal Server Error", { status: 500 });
			return errorResponse;
		}
	},
};
