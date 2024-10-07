import Makoto, { State } from "~/components/Makoto";
import type { Makoto as MakotoDocument } from "~/.server/db/models/makoto";
import * as makotoService from "~/.server/db/service/makoto";
import { useLoaderData } from "@remix-run/react";
import { SerializeFrom } from "@remix-run/node";
import dayjs from "dayjs";

export const loader = (): Promise<MakotoDocument | null> => {
  return makotoService.getMakoto();
};

export default function Index() {
  const makoto: SerializeFrom<State> = useLoaderData<State>();
  const state: State = { ...makoto, born: dayjs(makoto.born).toDate() };

  return (
    <div className="flex items-center justify-center w-screen h-screen overflow-hidden">
      <Makoto state={ state } />
    </div>
  );
}
