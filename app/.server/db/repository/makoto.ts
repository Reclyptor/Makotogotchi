import { Makoto } from "~/.server/db/models/makoto";
import { UpdateWriteOpResult } from "mongoose";
import { ObjectId } from "mongodb";

export const createMakoto = (makoto: Makoto): Promise<Makoto> => {
  return Makoto.create(makoto).then(result => result.toObject<Makoto>());
};

export const getMakotoByID = (id: ObjectId): Promise<Makoto | undefined> => {
  return Makoto.findOne({ _id: id }).then(result => result?.toObject<Makoto>());
};

export const updateMakotoByID = (id: ObjectId, makoto: Partial<Makoto>): Promise<UpdateWriteOpResult> => {
  return Makoto.updateOne({ _id: id }, makoto);
};