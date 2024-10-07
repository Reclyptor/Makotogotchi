import * as makotoRepository from '../repository/makoto';
import { ObjectId } from "mongodb";
import { Makoto } from "~/.server/db/models/makoto";
import { UpdateWriteOpResult } from "mongoose";

const GLOBAL_MAKOTO_ID: ObjectId = ObjectId.createFromHexString("000000000000000000000000");

const INITIAL_STATE = (): Makoto => ({
  _id: GLOBAL_MAKOTO_ID,
  born: new Date(Date.now()),
  hunger: 0,
  happiness: 100,
  sick: false,
  sleeping: false
});

export const getMakoto = (): Promise<Makoto> => {
  return makotoRepository.getMakotoByID(GLOBAL_MAKOTO_ID).then(makoto => makoto || makotoRepository.createMakoto(INITIAL_STATE()));
};

export const updateMakoto = (makoto: Partial<Makoto>): Promise<UpdateWriteOpResult> => {
  return makotoRepository.updateMakotoByID(GLOBAL_MAKOTO_ID, makoto);
};