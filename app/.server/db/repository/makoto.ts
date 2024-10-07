import { Makoto } from "~/.server/db/models/makoto";
import { UpdateWriteOpResult } from "mongoose";
import { ObjectId } from "mongodb";

export const getMakotoByID = (id: ObjectId): Promise<Makoto | null> => {
  return Makoto.findOne({ _id: id });
};

export const updateMakotoByID = (id: ObjectId, makoto: Partial<Makoto>): Promise<UpdateWriteOpResult> => {
  return Makoto.updateOne({ _id: id }, makoto)
};