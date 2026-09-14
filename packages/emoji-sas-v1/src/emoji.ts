/**
 * Matrix's published SAS emoji set — 64 entries, used verbatim.
 *
 * NOT OURS TO INVENT. E3 of the phone-initiated-enrolment design and the emoji-SAS
 * design both say it in the same words: Matrix specifies 64 emoji with names and
 * translations *because visual ambiguity breaks the comparison*. A home-grown set
 * is a footgun wearing a costume, and a trimmed count is a weakened security
 * parameter rather than a prettier screen.
 *
 * SOURCE, so a future reader can re-derive rather than trust this comment:
 *   https://raw.githubusercontent.com/matrix-org/matrix-spec/main/data-definitions/sas-emoji.json
 *   sha256 2b4defb276d61f11cb9cbfb0ba326b96a8dbd9e768e6bc53fa0f565cd598e887
 * Transcribed mechanically from that file — `index` is its `number`, `emoji` its
 * `emoji` (code points preserved, variation selectors included), `description` its
 * English `description`. The upstream translations are deliberately NOT carried:
 * nothing here renders a localized name yet, and a copied translation table that
 * no code reads is a table that silently rots.
 *
 * GENERATED-BY-HAND-ONCE, then owned: the code-point comment on each line is what
 * makes a corrupted paste visible in review (⌛ U+231B is not ⛛, and ☁️ carries a
 * U+FE0F the terminal will not show you).
 */

/** One entry of the comparison alphabet. */
export interface SasEmoji {
	/** Its position in Matrix's set, 0..63. This is the value the bits map to. */
	readonly index: number;
	/** The glyph, exactly as the Matrix spec publishes it. */
	readonly emoji: string;
	/** Matrix's English name. Shown beside the glyph — two screens rendering the
	 *  same code point through different fonts is precisely the ambiguity a name
	 *  resolves. */
	readonly description: string;
}

/** Matrix's 64, in order. Index i IS `MATRIX_SAS_EMOJI[i].index`. */
export const MATRIX_SAS_EMOJI: readonly SasEmoji[] = [
	{ index: 0, emoji: "🐶", description: "Dog" }, // U+1F436
	{ index: 1, emoji: "🐱", description: "Cat" }, // U+1F431
	{ index: 2, emoji: "🦁", description: "Lion" }, // U+1F981
	{ index: 3, emoji: "🐎", description: "Horse" }, // U+1F40E
	{ index: 4, emoji: "🦄", description: "Unicorn" }, // U+1F984
	{ index: 5, emoji: "🐷", description: "Pig" }, // U+1F437
	{ index: 6, emoji: "🐘", description: "Elephant" }, // U+1F418
	{ index: 7, emoji: "🐰", description: "Rabbit" }, // U+1F430
	{ index: 8, emoji: "🐼", description: "Panda" }, // U+1F43C
	{ index: 9, emoji: "🐓", description: "Rooster" }, // U+1F413
	{ index: 10, emoji: "🐧", description: "Penguin" }, // U+1F427
	{ index: 11, emoji: "🐢", description: "Turtle" }, // U+1F422
	{ index: 12, emoji: "🐟", description: "Fish" }, // U+1F41F
	{ index: 13, emoji: "🐙", description: "Octopus" }, // U+1F419
	{ index: 14, emoji: "🦋", description: "Butterfly" }, // U+1F98B
	{ index: 15, emoji: "🌷", description: "Flower" }, // U+1F337
	{ index: 16, emoji: "🌳", description: "Tree" }, // U+1F333
	{ index: 17, emoji: "🌵", description: "Cactus" }, // U+1F335
	{ index: 18, emoji: "🍄", description: "Mushroom" }, // U+1F344
	{ index: 19, emoji: "🌏", description: "Globe" }, // U+1F30F
	{ index: 20, emoji: "🌙", description: "Moon" }, // U+1F319
	{ index: 21, emoji: "☁️", description: "Cloud" }, // U+2601 U+FE0F
	{ index: 22, emoji: "🔥", description: "Fire" }, // U+1F525
	{ index: 23, emoji: "🍌", description: "Banana" }, // U+1F34C
	{ index: 24, emoji: "🍎", description: "Apple" }, // U+1F34E
	{ index: 25, emoji: "🍓", description: "Strawberry" }, // U+1F353
	{ index: 26, emoji: "🌽", description: "Corn" }, // U+1F33D
	{ index: 27, emoji: "🍕", description: "Pizza" }, // U+1F355
	{ index: 28, emoji: "🎂", description: "Cake" }, // U+1F382
	{ index: 29, emoji: "❤️", description: "Heart" }, // U+2764 U+FE0F
	{ index: 30, emoji: "😀", description: "Smiley" }, // U+1F600
	{ index: 31, emoji: "🤖", description: "Robot" }, // U+1F916
	{ index: 32, emoji: "🎩", description: "Hat" }, // U+1F3A9
	{ index: 33, emoji: "👓", description: "Glasses" }, // U+1F453
	{ index: 34, emoji: "🔧", description: "Spanner" }, // U+1F527
	{ index: 35, emoji: "🎅", description: "Santa" }, // U+1F385
	{ index: 36, emoji: "👍", description: "Thumbs Up" }, // U+1F44D
	{ index: 37, emoji: "☂️", description: "Umbrella" }, // U+2602 U+FE0F
	{ index: 38, emoji: "⌛", description: "Hourglass" }, // U+231B
	{ index: 39, emoji: "⏰", description: "Clock" }, // U+23F0
	{ index: 40, emoji: "🎁", description: "Gift" }, // U+1F381
	{ index: 41, emoji: "💡", description: "Light Bulb" }, // U+1F4A1
	{ index: 42, emoji: "📕", description: "Book" }, // U+1F4D5
	{ index: 43, emoji: "✏️", description: "Pencil" }, // U+270F U+FE0F
	{ index: 44, emoji: "📎", description: "Paperclip" }, // U+1F4CE
	{ index: 45, emoji: "✂️", description: "Scissors" }, // U+2702 U+FE0F
	{ index: 46, emoji: "🔒", description: "Lock" }, // U+1F512
	{ index: 47, emoji: "🔑", description: "Key" }, // U+1F511
	{ index: 48, emoji: "🔨", description: "Hammer" }, // U+1F528
	{ index: 49, emoji: "☎️", description: "Telephone" }, // U+260E U+FE0F
	{ index: 50, emoji: "🏁", description: "Flag" }, // U+1F3C1
	{ index: 51, emoji: "🚂", description: "Train" }, // U+1F682
	{ index: 52, emoji: "🚲", description: "Bicycle" }, // U+1F6B2
	{ index: 53, emoji: "✈️", description: "Aeroplane" }, // U+2708 U+FE0F
	{ index: 54, emoji: "🚀", description: "Rocket" }, // U+1F680
	{ index: 55, emoji: "🏆", description: "Trophy" }, // U+1F3C6
	{ index: 56, emoji: "⚽", description: "Ball" }, // U+26BD
	{ index: 57, emoji: "🎸", description: "Guitar" }, // U+1F3B8
	{ index: 58, emoji: "🎺", description: "Trumpet" }, // U+1F3BA
	{ index: 59, emoji: "🔔", description: "Bell" }, // U+1F514
	{ index: 60, emoji: "⚓", description: "Anchor" }, // U+2693
	{ index: 61, emoji: "🎧", description: "Headphones" }, // U+1F3A7
	{ index: 62, emoji: "📁", description: "Folder" }, // U+1F4C1
	{ index: 63, emoji: "📌", description: "Pin" }, // U+1F4CC
];

/** The alphabet size. 64 ⇒ 6 bits per emoji. */
export const SAS_EMOJI_SET_SIZE = 64;

/**
 * How many emoji are compared. SEVEN, and it is a security parameter rather than a
 * layout choice: 7 × 6 = 42 bits, which is what Matrix compares.
 *
 * An earlier pass of this design twice wrote "6 emoji, about 36 bits". That was
 * wrong, and it is corrected here rather than quietly: a design built on the
 * smaller figure would be 64× weaker than the reference it claims to follow.
 */
export const SAS_EMOJI_COUNT = 7;

/** Bits a comparison actually carries. */
export const SAS_BITS = SAS_EMOJI_COUNT * 6;

/**
 * Matrix's bit-slicing, unchanged: seven 6-bit indices taken from the first six
 * bytes, most-significant-bit first, discarding the trailing 6 bits.
 *
 * PURE. Deliberately reads exactly six bytes and refuses anything shorter — a
 * short input silently producing fewer (or zero-padded) emoji would weaken the
 * comparison in the one direction nobody would notice.
 */
export function sasIndicesFromBytes(bytes: Uint8Array): number[] {
	if (bytes.length < 6) {
		throw new RangeError(
			`sasIndicesFromBytes needs at least 6 bytes for ${SAS_BITS} bits, got ${bytes.length}`,
		);
	}
	const b = bytes;
	return [
		b[0]! >> 2,
		((b[0]! & 0x03) << 4) | (b[1]! >> 4),
		((b[1]! & 0x0f) << 2) | (b[2]! >> 6),
		b[2]! & 0x3f,
		b[3]! >> 2,
		((b[3]! & 0x03) << 4) | (b[4]! >> 4),
		((b[4]! & 0x0f) << 2) | (b[5]! >> 6),
	];
}

/** Indices → the emoji to show. Throws on an out-of-range index rather than
 *  rendering `undefined` into a row a human is about to trust. */
export function sasEmojiFromIndices(indices: readonly number[]): SasEmoji[] {
	return indices.map((index) => {
		const entry = MATRIX_SAS_EMOJI[index];
		if (!entry) throw new RangeError(`SAS emoji index out of range: ${index}`);
		return entry;
	});
}

/** One row, as both screens must render it: glyph and name, in order, never sorted. */
export function formatSasRow(emoji: readonly SasEmoji[]): string {
	return emoji.map((e) => `${e.emoji} ${e.description}`).join("   ");
}
