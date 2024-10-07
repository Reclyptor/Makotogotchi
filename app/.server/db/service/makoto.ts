import * as makotoRepository from '../repository/makoto';
import { ObjectId } from "mongodb";
import { Makoto } from "~/.server/db/models/makoto";
import { UpdateWriteOpResult } from "mongoose";

const GLOBAL_MAKOTO_ID: ObjectId = ObjectId.createFromHexString("000000000000000000000000");

export const getMakoto = (): Promise<Makoto | null> => {
  return makotoRepository.getMakotoByID(GLOBAL_MAKOTO_ID);
};

export const updateMakoto = (makoto: Partial<Makoto>): Promise<UpdateWriteOpResult> => {
  return makotoRepository.updateMakotoByID(GLOBAL_MAKOTO_ID, makoto);
};