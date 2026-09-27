// The same card for the same reason (SPEC §21.7); Twitter reads its own tag.
// Segment config has to be spelled out here — Next reads it statically and
// will not follow a re-export — so `dynamic` is declared rather than shared.

import Image from "./opengraph-image";

export { alt, size, contentType } from "./opengraph-image";
export const dynamic = "force-dynamic";

export default Image;
