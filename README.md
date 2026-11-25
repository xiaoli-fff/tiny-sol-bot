# tiny-sol-bot

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/xiaoli-fff/tiny-sol-bot/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/xiaoli-fff/tiny-sol-bot/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A bounce-aware EMA-crossover paper-trading bot for hourly Solana prices: it buys EMA(8) crossing above EMA(21) only when the close is already above the slow EMA and RSI(14) is under 62, and exits on a cross back down, a +40% take-profit, or a -12% stop-loss.

## Run it

```sh
node main.ts
```

The bot speaks the agent-fun/bars-replay/v1 protocol on stdin/stdout (see `vendor/makefun-bars.ts`); grade it locally with the make.fun kit:

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver docker
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=xiaoli-fff&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
