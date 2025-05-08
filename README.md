# A Simple Balloon Popping Game to Illustrate the Need for ETags

Under https://apprenticeship-day-balloon-game.tanju-cloudflare.workers.dev/balloonpage there is a red balloon shown. Middle school students need to send PUT requests to the Cloudflare Worker Service that provides an https://apprenticeship-day-balloon-game.tanju-cloudflare.workers.dev/balloon endpoint in order to increase the fillStatus by 1%. GET requests return the balloon’s current fill level, ranging from 0% to 100%.

Middle school students can send a PUT request to /balloon to increase the fill level by 1%. To do this successfully, they must include the correct ETag value in their request, ensuring they are working with the most recent state. Additionally, they must implement a meaningful retry mechanism to respect the server’s dynamic rate-limiting behavior, which alternates and cannot be bypassed with a fixed interval.

A second endpoint, /userStatistics, displays a leaderboard showing the most successful contributions per username.

Goals
The goal of this exercise is to introduce middle school students to concurrency challenges and demonstrate how to manage them using ETag-based control.


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
