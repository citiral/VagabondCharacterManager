# Vagabond Character Sheet Editor

Extremely vibe coded, and made just for fun to help us in our campaign. Expect rough edges.

A shared character manager for [Vagabond](https://landoftheblind.myshopify.com/collections/vagabond-pulp-fantasy-rpg), the pulp fantasy RPG from Land of the Blind. It builds a hero from ancestry, class, stats, trainings, perks, spells, and gear, then tracks the numbers you touch in play: hit points, mana, luck, fatigue, wealth, and dice.

Open the same address on another machine at the table and everyone shares one party, live. Heroes are saved on the server. With no database configured, they go in a local SQLite file. Set `DATABASE_URL` to use Postgres instead (as on Deno Deploy).

Rules data is original shorthand for use at the table, based on the Core Rulebook v3 alpha 3 preview. It is not a substitute for the book.

![Hero record](docs/hero-record.png)

## Run

Install [Deno](https://deno.land/), then from this directory:

```sh
deno task start
```

Open http://localhost:8080. The party is stored in `data/vagabond.sqlite`.

Optional environment variables (see `.env.example`):

- `PORT` — listen port, default `8080`
- `DATABASE_URL` — Postgres connection string. When unset, the app uses SQLite.

```sh
deno task test
```
