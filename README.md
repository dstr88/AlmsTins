# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Aave GraphQL Checks

Markets:

```bash
curl -s https://api.v3.aave.com/graphql \
  -H "content-type: application/json" \
  --data-binary '{
    "query":"query($chainIds:[ChainId!]!,$user:EvmAddress){ markets(request:{chainIds:$chainIds,user:$user}){ name address chain{chainId} } }",
    "variables": { "chainIds":[1,137,43114], "user":"0x32b7501a48818c787f0d7cf85a29d5b6189fa58b" }
  }' | jq
```

User market state (replace market address from the markets result):

```bash
curl -s https://api.v3.aave.com/graphql \
  -H "content-type: application/json" \
  --data-binary '{
    "query":"query($request:UserMarketStateRequest!){ userMarketState(request:$request){ healthFactor totalCollateralBase totalDebtBase availableBorrowsBase } }",
    "variables": { "request": { "chainId":137, "market":"0xMARKETADDRESS", "user":"0x32b7501a48818c787f0d7cf85a29d5b6189fa58b" } }
  }' | jq
```

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
