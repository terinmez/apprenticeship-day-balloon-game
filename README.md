# A Simple Game to Illustrate the Need for ETags

This Cloudflare Worker Service offers an endpoint /balloon to read its current fill status between 0-100%. The Balloon will also deflate constantly with a rate of 1%/seconds.

Middleschool Students need to do a PUT on /adobe/ increase the fill by 1. In order to be successful they need to use the current ETag. In addition they need to honor the rate limit by implementing a meaningful retry interval. The server will alternate its rate limiting behavior, so they cannot just use a fix interval.

A second endpoint /stats will provide a list with the most successful hits per Username 
## Goals

Middleschool Students shall get a feel for concurrency problems and how to avoid them. In this case the approach with ETag is demonstrated.

1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler
4. Run `wrangler dev` in terminal to start this Service locally on port 8787   

    ```
    curl -X 'GET' \
    'http://localhost:8787/balloon' \
    -H 'Accept: application/json' \
    -H 'Authorization: Bearer <username>'
    ```

8. When you want to deploy, it to Cloudflare, simply run `wrangler deploy` to publish the API to Cloudflare Workers.

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

1. Run `wrangler dev` to start a local instance of the API.
2. Open `http://localhost:8786/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.
