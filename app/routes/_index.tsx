import Makoto from "~/components/Makoto";
import useMakotoState from "~/hooks/useMakotoState";
import { range } from "~/util/array";
import { useRef } from "react";
import { Atom as EnergyIcon, Heart as HeartIcon } from "lucide-react";

export default function Index() {
  const { state, dispatch, reset } = useMakotoState();
  const { current: debug } = useRef<boolean>([...new URL(location.href).searchParams.keys()].includes("debug"));

  return (
    <div className="w-screen h-screen overflow-hidden">
      <div
        className="flex items-center justify-center w-full h-full [background-image:linear-gradient(32deg,_rgba(217,_202,_178,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_50%,_rgba(217,_202,_178,_0.40)_50%,_rgba(217,_202,_178,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_100%);] [background-size:113.22px_70.75px;] [animation:slide_10s_infinite] backdrop-blur-3xl">
        { debug &&
          <div className="absolute top-0 left-0">
            <pre className="font-bold text-sm">{ JSON.stringify(state, null, 2) }</pre>
          </div>
        }

        <button type="button" onClick={ reset } className="group absolute top-1 right-1 flex items-center justify-center w-8 h-8 rounded-full backdrop-blur-3xl bg-black/30 hover:bg-black/50 shadow-2xl">
          <span className="text-[8px] font-bold text-black group-hover:text-[--background]">RESET</span>
        </button>

        <div
          className="flex flex-col items-center justify-center w-fit h-fit overflow-hidden rounded-3xl backdrop-blur-3xl bg-white/30">
          <div className="flex items-center w-fit h-fit p-4">
            { range(10).map((idx) => <HeartIcon key={ idx } size={ 32 } stroke="#6F1200" fill={ Math.trunc(state.hp / 10) > idx ? "#6F1200" : "transparent" }/>) }
          </div>

          <Makoto state={ state }/>

          <div className="flex items-center w-fit h-fit p-4">
            { range(10).map((idx) => <EnergyIcon key={ idx } size={ 32 } strokeWidth={ 1.25 } stroke={ Math.trunc(state.energy / 10) > idx ? "#A903A9" : "#00000040" } fill={ Math.trunc(state.energy / 10) > idx ? "#A903A926" : "#FFFFFF2E" } />) }
          </div>
        </div>
      </div>
    </div>
  );
}
