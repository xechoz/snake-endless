# Bloomtail: Endless

The arcade half of Bloomtail, split into its own game. Eat fruit, paint the
garden, chain bites, collect super fruit and chase a new best score. There are
no levels or step limits here; the only goal is to survive and keep the run
alive.

This repository is independent from `xechoz/snake`, which now contains only the
handcrafted **Bloomtail: Color Trail** campaign. Both games share the garden
fruit art, but they have separate manifests, saves, menus and release builds.

Clone with the platform submodule:

```bash
git clone --recurse-submodules git@github.com:xechoz/snake-endless.git
cd snake-endless
npm ci
npm run dev
```

The platform is pinned at `v4.0.0` in `platform/`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run check` | Typecheck, Biome and game boundary checks |
| `npm run test` | Vitest |
| `npm run build` | Production self-hosted build |
| `npm run package:web` | `snake-endless-web.zip` release asset |
| `npm run package:poki` | Poki build |
| `npm run package:crazy:basic` | CrazyGames lifecycle build |
| `npm run package:crazy:full` | CrazyGames lifecycle + ads build |

## Notes

- Save key: `mg:snake-endless:save`; there is no migration from the campaign
  save.
- Endless keeps the garden fruit art and skins.
- Rewarded super fruit and pause/restart interstitials are part of this game.
- The campaign lives in `xechoz/snake`.

## Local CrazyGames preview

```bash
./run-crazygames.sh basic   # http://localhost:8080
./run-crazygames.sh full    # http://localhost:8081
```

Build the matching zip first with `npm run package:crazy:basic` or
`npm run package:crazy:full`.
