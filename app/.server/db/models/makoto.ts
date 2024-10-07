import mongoose from "mongoose";

export type Makoto = {
  born: Date;
  hunger: number;
  happiness: number;
  sick: boolean;
  sleeping: boolean;
};

const schema = new mongoose.Schema<Makoto>({
  born: { type: Date, required: true },
  hunger: { type: Number, required: true },
  happiness: { type: Number, required: true },
  sick: { type: Boolean, required: true },
  sleeping: { type: Boolean, required: true },
}, { collection: "makotos", versionKey: false });

export const Makoto = mongoose.model<Makoto>("Makoto", schema);