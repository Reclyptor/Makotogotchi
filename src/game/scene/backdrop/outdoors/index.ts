// The outdoor venues (SPEC §22.8), composed a pixel at a time with the same
// discipline as the room (§22.6): every colour is a named venue ramp, every
// gradient an ordered dither between adjacent ramp values, and the sky is
// the very machinery the window shows — drawn full-bleed, because out here
// there is no pane between the pet and the weather.
//
// **Every venue sets its own horizon, and that is the point.** A shared
// horizon with a shared recipe — sky, a ten-pixel silhouette strip, one flat
// plane of ground — produces places that differ only in tint, and at this
// resolution a tint is not a place. So the forest is roofed and hemmed in,
// the meadow is almost entirely sky, the pond is almost entirely water, and
// the shrine's gate is big enough to stand under. What distinguishes them is
// composition: where the eye line sits, what breaks it, and how much of the
// frame each element is allowed to take.
//
// One file per venue, because that independence is real: a venue's ramps,
// horizon function, composer and live layer are read and edited together and
// have nothing to say to any other venue. Everything genuinely common — the
// sky, the pixel buffer, the winter cover every ground shares — lives in
// `shared.ts`, and this module re-exports the whole surface so callers still
// import one thing.

export { OUTDOOR_SPAN, WINTER_COVER } from "./shared";

export { GARDEN, GARDEN_HORIZON, gardenHorizonAt, composeGarden } from "./garden";
export { MEADOW, MEADOW_HORIZON, meadowHorizonAt, composeMeadow } from "./meadow";
export { BEACH, BEACH_HORIZON, beachHorizonAt, composeBeach, renderBeachLive } from "./beach";
export { FOREST, FOREST_HORIZON, forestHorizonAt, composeForest } from "./forest";
export { SHRINE, SHRINE_HORIZON, shrineHorizonAt, composeShrine } from "./shrine";
export { POND, POND_HORIZON, pondHorizonAt, composePond, renderPondLive } from "./pond";
export { BLOSSOM, BLOSSOM_HORIZON, blossomHorizonAt, composeBlossom, renderBlossomLive } from "./blossom";
export { MOUNTAIN, MOUNTAIN_HORIZON, mountainHorizonAt, composeMountain } from "./mountain";
