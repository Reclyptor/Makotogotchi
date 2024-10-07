import Makoto, { State } from "~/components/Makoto";
import type { Makoto as MakotoDocument } from "~/.server/db/models/makoto";
import * as makotoService from "~/.server/db/service/makoto";
import { useLoaderData } from "react-router";

export const loader = (): Promise<MakotoDocument | null> => {
  return makotoService.getMakoto();
};

export default function Index() {
  const makoto = useLoaderData() as State;

  return (
    <div className="flex items-center justify-center w-screen h-screen overflow-hidden">
      <Makoto state={ makoto } />
    </div>
  );
}
