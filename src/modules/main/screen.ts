import { InlineKeyboard } from "grammy";
import type { AppContext } from "../../core/bot.js";
import { depositAddress } from "../../core/settings.js";
import type { WalletMethod } from "./content.js";

export function backRow(keyboard: InlineKeyboard, back: string): InlineKeyboard {
  return keyboard.row().text("⬅ Back", back);
}

export async function editScreen(ctx: AppContext, text: string, keyboard: InlineKeyboard): Promise<void> {
  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "HTML" }).catch((err: unknown) => {
    const description = (err as { description?: string }).description ?? "";
    if (!description.includes("message is not modified")) throw err;
  });
}

export async function showDepositAddress(
  ctx: AppContext,
  wallet: WalletMethod,
  back: string,
): Promise<void> {
  const address = await depositAddress(wallet);

  if (!address) {
    await editScreen(
      ctx,
      `${wallet.icon} <b>${wallet.label} deposits</b>

⚠️ No ${wallet.asset} address is published yet.

Tap below and an admin will send you the live ${wallet.network} address.`,
      new InlineKeyboard()
        .text("📞 Get Deposit Address", "main:contact")
        .row()
        .text("⬅ Back", back)
        .text("🏠 Main Menu", "main:menu"),
    );
    return;
  }

  await editScreen(
    ctx,
    `${wallet.icon} <b>Send ${wallet.asset} — ${wallet.label}</b>

👇 <b>Tap the address to copy it</b>

<pre>${address}</pre>

📡 <b>Network:</b> ${wallet.network}
⏱ <b>Credited after:</b> ${wallet.speed}

⚠️ Send <b>only ${wallet.asset}</b> on the <b>${wallet.network}</b> network. Payments sent on any other network cannot be recovered.

Next step: send us the transaction ID so we can credit you faster.`,
    new InlineKeyboard()
      .text("✅ I Have Sent The Payment", `main:deposit_sent_${wallet.key}`)
      .row()
      .text("⬅ Back", back)
      .text("🏠 Main Menu", "main:menu"),
  );
}
