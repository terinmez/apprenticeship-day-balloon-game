# A Simple Balloon Popping Game Service Illustrating Concurrency

Visit the game at:  
🔗 https://apprenticeship-day-balloon-game.tanju-cloudflare.workers.dev/balloonpage  
You’ll see a red balloon waiting to be filled.

Clients interact with a Cloudflare Worker Service by sending `PUT` requests to the following endpoint:  
🔗 https://apprenticeship-day-balloon-game.tanju-cloudflare.workers.dev/balloon

Each `PUT` request increases the balloon’s `fillStatus` by 1%. However, since many clients may attempt this simultaneously, the service presents **concurrency challenges**.

To successfully fill the balloon:
1. The client must first determine the current `fillStatus` (using a `GET`).
2. Then, it must send a `PUT` request with an `If-Match` header based on the current ETag to increase `fillStatus` by exactly 1%.

## Response Codes

The service responds with the following HTTP status codes:

- `200 OK` – Filling was successful.
- `400 Bad Request` – The request attempted to:
  - Fill beyond 100%.
  - Decrease the `fillStatus`.
  - Increase it by more than 1%.
- `412 Precondition Failed` – Another client updated the balloon before this request. The client must fetch the latest state and retry.
- `429 Too Many Requests` – The client sent too many requests in a short period. A `Retry-After` header is returned. Repeated disregard increases the wait time (up to 1 minute), which then decreases automatically over time.

---

# For Teachers: How Should Students Approach This?

First, assess your students’ experience level with programming.

In my class, I started with a **Sequence Diagram** on a whiteboard, illustrating the interaction between a client and a server. This helped visualize request/response mechanics and established a baseline for understanding.

Then, I revisited a basic question:  
**How does a client fetch a webpage?**  
This helped gauge how familiar the group was with web protocols and client-server concepts.

From there, I introduced the idea of using `PUT` to change data on the server. I then explained the error codes (above) using various real-world scenarios drawn on the board.

> ⚠️ Keep an eye on the group’s engagement. In my case, 2 of 8 students were very engaged, while the rest struggled—so I adjusted accordingly.

Instead of going deep into how the backend algorithm works, I presented a **puzzle-style challenge** using a partially completed client script.


## The Student Challenge

Students received a `balloon-client.sh` script that contains a working loop — but with 5 key statements missing.

A comment block contains those 5 statements. The task is to insert them into the correct spots in the loop logic to complete the client interaction.

### Observations:
- Two advanced students quickly solved the puzzle.
  - One experimented by increasing the fill rate.
  - The other removed the end condition to explore what happens beyond 100%.

Additionally, there’s a hidden "Easter Egg" in the form of **insecure authentication**. I hoped a student would attempt to spoof another’s `userName` to spark a discussion on API security.


# Developing/Running the Service

1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler


### Option 1: Run Locally
Use `wrangler dev` to serve the project locally. Share your local IP with students.  
You'll need to update the following:
- `public/balloonpage/index.html`
- `balloon-client.sh`  
Update both to reflect your local address.

You can then access interact with the service as follows:
``` curl
curl -X 'GET' \
'http://localhost:8787/balloon' \
-H 'Accept: application/json' \
-H 'Authorization: Bearer <userName>'
```
``` curl
curl -v -X PUT \
'http://localhost:8787/balloon' \
-H 'Authorization: Bearer <userName>' \
-H 'If-Match: <a current ETag, you get one with a GET. Make sure to include the Quotation marks like "b7801a4f140ad9aff5602b10d0783a4f112dadb5">' \
-d '{"fillStatus": 3}'
```
The Balloon Page appears under `http://localhost:8787/balloonpage`


### Option 2: Deploy to Cloudflare
Alternatively, you can deploy the project with `wrangler deploy`. Before you deploy it make sure to adapt the index.html and the balloon-client.sh to your cloudflare worker's domain name.

You can then access interact with the service as follows:
``` curl
curl -X 'GET' \
'https://<yourdomain>/balloon' \
-H 'Accept: application/json' \
-H 'Authorization: Bearer <userName>'
```
``` curl
curl -v -X PUT \
'https://<yourdomain>/balloon' \
-H 'Authorization: Bearer <userName>' \
-H 'If-Match: <a current ETag, you get one with a GET. Make sure to include the Quotation marks like "b7801a4f140ad9aff5602b10d0783a4f112dadb5">' \
-d '{"fillStatus": 3}'
```
The Balloon Page appears under `https://<yourdomain>/balloonpage`


## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

1. Run `wrangler dev` to start a local instance of the API.
2. Open `http://localhost:8787/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.
