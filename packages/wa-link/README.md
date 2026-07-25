# @refarm.dev/wa-link

Build a WhatsApp **click-to-chat** ([wa.me](https://wa.me)) deep link and its
prefilled message from a phone number and a template. Zero-dependency, pure,
runs in the browser (where the link is clicked) and in Node (where a site is
built).

The primitive a **static shop** uses to turn a product form into a "buy on
WhatsApp" link with the order already written — **no backend, no database**: the
order lands in the seller's WhatsApp, where the free WhatsApp Business app counts
and organizes it.

```js
import { orderLink } from "@refarm.dev/wa-link";

const href = orderLink({
  phone: "55 11 91234-5678",                    // any format — normalized to digits
  template: "Oi! Quero {qty}x {produto} 🍬",
  values: { qty: 2, produto: "brigadeiro" },
});
// → https://wa.me/5511912345678?text=Oi!%20Quero%202x%20brigadeiro%20🍬
```

Also exported: `buildWaLink({ phone, text })`, `fillTemplate(template, values)`,
`normalizePhone(raw)`.

First block of the **refarm.shop** surface — see
`docs/superpowers/specs/2026-07-25-refarm-shop-design.md`.
